// Chromium launcher for local browser smoke tests that renders on the discrete
// NVIDIA GPU (Vulkan through ANGLE) instead of SwiftShader on the CPU.
//
// Usage (the caller passes its own playwright-core `chromium`, so the repo needs
// no Playwright dependency):
//   const { chromium } = require("playwright-core");
//   const { launchGpu } = require("<repo>/scripts/smoke/gpu-launch.cjs");
//   const browser = await launchGpu(chromium, { executablePath, ...launchOptions });
//
// If the GPU launch fails (no NVIDIA driver, no Vulkan ICD) it falls back to the
// normal CPU launch with the same options. The renderer string is logged once.

const GPU_ENV = {
  __NV_PRIME_RENDER_OFFLOAD: "1",
  __GLX_VENDOR_LIBRARY_NAME: "nvidia",
  __VK_LAYER_NV_optimus: "NVIDIA_only",
  VK_ICD_FILENAMES: "/usr/share/vulkan/icd.d/nvidia_icd.json",
};

const GPU_ARGS = [
  "--enable-gpu",
  "--ignore-gpu-blocklist",
  "--use-angle=vulkan",
  "--enable-features=Vulkan",
  "--enable-gpu-rasterization",
  "--enable-zero-copy",
];

let logged = false;

async function rendererOf(browser) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
    });
  } finally {
    await page.close();
  }
}

async function launchGpu(chromium, opts = {}) {
  const args = [...GPU_ARGS, ...(opts.args ?? [])];
  const env = { ...process.env, ...GPU_ENV, ...(opts.env ?? {}) };
  try {
    const browser = await chromium.launch({ headless: true, ...opts, args, env });
    if (!logged) {
      logged = true;
      console.error(`[gpu-launch] renderer: ${await rendererOf(browser)}`);
    }
    return browser;
  } catch (e) {
    console.error(`[gpu-launch] GPU launch failed, using the CPU: ${String(e).slice(0, 160)}`);
    return chromium.launch({ headless: true, ...opts });
  }
}

module.exports = { launchGpu, GPU_ARGS, GPU_ENV };
