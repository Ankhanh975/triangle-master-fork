(() => {
	const container = document.getElementById('container');

	if (!container) {
		return;
	}

	let overlayBounds = {
		x: 0,
		y: 0,
		width: window.innerWidth,
		height: window.innerHeight,
	};

	const PIXEL_STEP = 2;
	const TARGET_FPS = 15;
	const BINS_PER_CHANNEL = 32;
	const BIN_COUNT = BINS_PER_CHANNEL * BINS_PER_CHANNEL * BINS_PER_CHANNEL;

	let SAMPLE_WIDTH = Math.floor(overlayBounds.width / PIXEL_STEP);
	let SAMPLE_HEIGHT = Math.floor(overlayBounds.height / PIXEL_STEP);

	const colorStats = {
		timestamp: 0,
		sampleWidth: SAMPLE_WIDTH,
		sampleHeight: SAMPLE_HEIGHT,
		totalPixels: SAMPLE_WIDTH * SAMPLE_HEIGHT,
		top5: [],
	};

	window.overlayColorStats = colorStats;

	function dispatchSyntheticMouseMove(point) {
		const x = Math.max(0, Math.min(point.x, overlayBounds.width));
		const y = Math.max(0, Math.min(point.y, overlayBounds.height));

		const event = new MouseEvent('mousemove', {
			bubbles: true,
			cancelable: true,
			clientX: x,
			clientY: y,
			screenX: overlayBounds.x + x,
			screenY: overlayBounds.y + y,
			view: window,
		});

		container.dispatchEvent(event);
	}

	if (window.overlayApi) {
		window.overlayApi.onOverlayBounds((bounds) => {
			overlayBounds = bounds;
			SAMPLE_WIDTH = Math.floor(bounds.width / PIXEL_STEP);
			SAMPLE_HEIGHT = Math.floor(bounds.height / PIXEL_STEP);
			colorStats.sampleWidth = SAMPLE_WIDTH;
			colorStats.sampleHeight = SAMPLE_HEIGHT;
			colorStats.totalPixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
		});

		window.overlayApi.onCursorMove((point) => {
			dispatchSyntheticMouseMove(point);
		});
	}

	function binToRgb(binIndex) {
		const rBin = binIndex % BINS_PER_CHANNEL;
		const gBin = Math.floor(binIndex / BINS_PER_CHANNEL) % BINS_PER_CHANNEL;
		const bBin = Math.floor(binIndex / (BINS_PER_CHANNEL * BINS_PER_CHANNEL));

		const r = Math.min(255, Math.floor((rBin + 0.5) * (256 / BINS_PER_CHANNEL)));
		const g = Math.min(255, Math.floor((gBin + 0.5) * (256 / BINS_PER_CHANNEL)));
		const b = Math.min(255, Math.floor((bBin + 0.5) * (256 / BINS_PER_CHANNEL)));

		return [r, g, b];
	}

	function rgbToHex(r, g, b) {
		return `#${r.toString(16).padStart(2, '0')}${g
			.toString(16)
			.padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
	}

	function buildTop5FromHistogram(histogram, totalPixels) {
		const top5 = [];

		for (let i = 0; i < histogram.length; i += 1) {
			const count = histogram[i];
			if (count === 0) {
				continue;
			}

			if (top5.length < 5) {
				top5.push({ bin: i, count });
				top5.sort((a, b) => b.count - a.count);
				continue;
			}

			if (count > top5[top5.length - 1].count) {
				top5[top5.length - 1] = { bin: i, count };
				top5.sort((a, b) => b.count - a.count);
			}
		}

		return top5.map((entry) => {
			const [r, g, b] = binToRgb(entry.bin);
			return {
				bin: entry.bin,
				rgb: { r, g, b },
				hex: rgbToHex(r, g, b),
				count: entry.count,
				frequency: entry.count / totalPixels,
			};
		});
	}

	async function initGpuColorFrequencySampler() {
		if (!navigator.gpu) {
			console.error('WebGPU is not available. GPU color frequency sampler disabled.');
			return;
		}

		const stream = await navigator.mediaDevices.getDisplayMedia({
			video: {
				width: { ideal: overlayBounds.width },
				height: { ideal: overlayBounds.height },
				frameRate: { ideal: TARGET_FPS, max: TARGET_FPS },
			},
			audio: false,
		});

		const video = document.createElement('video');
		video.playsInline = true;
		video.muted = true;
		video.srcObject = stream;
		await video.play();

		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter) {
			console.error('No WebGPU adapter found. GPU color frequency sampler disabled.');
			return;
		}

		const device = await adapter.requestDevice();

		// Full resolution texture to capture the video stream
		const fullResTexture = device.createTexture({
			size: [overlayBounds.width, overlayBounds.height, 1],
			format: 'rgba8unorm',
			usage:
				GPUTextureUsage.COPY_DST |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC,
		});

		const histogramBufferSize = BIN_COUNT * Uint32Array.BYTES_PER_ELEMENT;
		const histogramBuffer = device.createBuffer({
			size: histogramBufferSize,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
		});

		const readbackBuffer = device.createBuffer({
			size: histogramBufferSize,
			usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		});

		const paramsBuffer = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		device.queue.writeBuffer(
			paramsBuffer,
			0,
			new Uint32Array([SAMPLE_WIDTH, SAMPLE_HEIGHT, SAMPLE_WIDTH * SAMPLE_HEIGHT, 0]),
		);

		const shaderModule = device.createShaderModule({
			code: `
struct Params {
  width: u32,
  height: u32,
  totalPixels: u32,
  _pad: u32,
};

@group(0) @binding(0) var frameTex: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram: array<atomic<u32>>;
@group(0) @binding(2) var<uniform> params: Params;

const BINS_PER_CHANNEL: u32 = ${BINS_PER_CHANNEL}u;
const PIXEL_STEP: u32 = 2u;
const CHANNEL_STRIDE: u32 = BINS_PER_CHANNEL;
const BLUE_STRIDE: u32 = BINS_PER_CHANNEL * BINS_PER_CHANNEL;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= params.width || gid.y >= params.height) {
    return;
  }

  // Sample every 2x2 pixels from the full resolution texture
  let px = textureLoad(frameTex, vec2<i32>(i32(gid.x * PIXEL_STEP), i32(gid.y * PIXEL_STEP)), 0);
  let r = min(u32(px.r * 255.0), 255u);
  let g = min(u32(px.g * 255.0), 255u);
  let b = min(u32(px.b * 255.0), 255u);

  let rq = min(r * BINS_PER_CHANNEL / 256u, BINS_PER_CHANNEL - 1u);
  let gq = min(g * BINS_PER_CHANNEL / 256u, BINS_PER_CHANNEL - 1u);
  let bq = min(b * BINS_PER_CHANNEL / 256u, BINS_PER_CHANNEL - 1u);

  let idx = rq + gq * CHANNEL_STRIDE + bq * BLUE_STRIDE;
  atomicAdd(&histogram[idx], 1u);
}
`,
		});

		const computePipeline = device.createComputePipeline({
			layout: 'auto',
			compute: {
				module: shaderModule,
				entryPoint: 'main',
			},
		});

		const bindGroup = device.createBindGroup({
			layout: computePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: fullResTexture.createView() },
				{ binding: 1, resource: { buffer: histogramBuffer } },
				{ binding: 2, resource: { buffer: paramsBuffer } },
			],
		});

		const zeroHistogram = new Uint32Array(BIN_COUNT);
		let inFlight = false;

		async function processFrame() {
			if (inFlight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
				return;
			}

			inFlight = true;

			try {
				device.queue.writeBuffer(histogramBuffer, 0, zeroHistogram);

				device.queue.copyExternalImageToTexture(
					{ source: video },
					{ texture: fullResTexture },
					[overlayBounds.width, overlayBounds.height],
				);

				const encoder = device.createCommandEncoder();
				const pass = encoder.beginComputePass();
				pass.setPipeline(computePipeline);
				pass.setBindGroup(0, bindGroup);
				pass.dispatchWorkgroups(
					Math.ceil(SAMPLE_WIDTH / 16),
					Math.ceil(SAMPLE_HEIGHT / 16),
					1,
				);
				pass.end();

				encoder.copyBufferToBuffer(histogramBuffer, 0, readbackBuffer, 0, histogramBufferSize);
				device.queue.submit([encoder.finish()]);

				await readbackBuffer.mapAsync(GPUMapMode.READ);
				const mapped = readbackBuffer.getMappedRange();
				const histogram = new Uint32Array(mapped.slice(0));
				readbackBuffer.unmap();

				colorStats.timestamp = Date.now();
				colorStats.top5 = buildTop5FromHistogram(histogram, SAMPLE_WIDTH * SAMPLE_HEIGHT);
			} catch (error) {
				console.error('GPU color frequency frame processing failed:', error);
			} finally {
				inFlight = false;
			}
		}

		const intervalMs = Math.round(1000 / TARGET_FPS);
		const timer = window.setInterval(() => {
			void processFrame();
		}, intervalMs);

		window.addEventListener('beforeunload', () => {
			window.clearInterval(timer);
			for (const track of stream.getTracks()) {
				track.stop();
			}
		});
	}

	void initGpuColorFrequencySampler();
})();
