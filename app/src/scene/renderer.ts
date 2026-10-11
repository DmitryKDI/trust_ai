import type { SceneModel } from './build';
import { nodeVertices } from './mesh';
import { BASE_COLORS, type MaterialSlot, type SceneMaterial } from './types';
import { isDesktop } from '../desktop';

export interface Camera { yaw: number; pitch: number; zoom: number }
export const DEFAULT_CAMERA: Camera = { yaw: -.65, pitch: 1.0, zoom: 1 };
export function createSceneRenderer(canvas: HTMLCanvasElement, scene: SceneModel, materials: Partial<Record<MaterialSlot, SceneMaterial>>, warn: (message: string) => void) {
  const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error(isDesktop ? '3D недоступно. Перезапустите программу и проверьте драйвер видеокарты.' : '3D недоступно в этом браузере. Включите аппаратное ускорение или откройте программу в Edge / Chrome.');
  const shaders: WebGLShader[] = [], buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = [];
  const shader = (type: number, source: string) => {
    const v = gl.createShader(type)!; shaders.push(v); gl.shaderSource(v, source); gl.compileShader(v);
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw new Error('Не удалось подготовить отображение 3D.'); return v;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `
    attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
    uniform vec3 center; uniform vec4 camera; uniform float aspect;
    varying float light; varying vec2 texUV;
    void main() {
      vec3 p = position - center;
      float cy = cos(camera.x), sy = sin(camera.x), cp = cos(camera.y), sp = sin(camera.y);
      float x = cy * p.x - sy * p.z, z = sy * p.x + cy * p.z;
      gl_Position = vec4(x / (camera.z * aspect), (cp * p.y - sp * z) / camera.z, -(sp * p.y + cp * z) / camera.w, 1.0);
      light = 0.65 + 0.35 * abs(dot(normal, normalize(vec3(-0.45, 0.85, -0.35)))); texUV = uv;
    }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
    precision mediump float; varying float light; varying vec2 texUV;
    uniform vec3 color; uniform sampler2D image; uniform bool textured; uniform vec2 tile;
    void main() { vec3 c = textured ? texture2D(image, fract(texUV / tile)).rgb : color; gl_FragColor = vec4(c * light, 1.0); }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Не удалось запустить отображение 3D.');
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const locations = { center: uniform('center'), camera: uniform('camera'), aspect: uniform('aspect'), color: uniform('color'), image: uniform('image'), textured: uniform('textured'), tile: uniform('tile') };
  const attrs = ['position', 'normal', 'uv'].map(n => gl.getAttribLocation(program, n));
  let disposed = false, camera = DEFAULT_CAMERA;
  const loading: Promise<void>[] = [];
  const groups = new Map<MaterialSlot, number[]>();
  for (const node of scene.nodes) { const values = nodeVertices(node), existing = groups.get(node.material) ?? []; for (const value of values) existing.push(value); groups.set(node.material, existing); }
  const batches = [...groups].map(([slot, values]) => {
    const buffer = gl.createBuffer()!; buffers.push(buffer); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    const material = materials[slot], color = material?.color ?? BASE_COLORS[slot];
    const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255);
    // У каждого пакета собственная полная текстура, даже без изображения.
    const texture = gl.createTexture()!; textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const batch = { buffer, count: values.length / 8, rgb, texture, textured: false, tile: [(material?.tileWidthMm ?? 1000) / 1000, (material?.tileHeightMm ?? 1000) / 1000] };
    if (material?.textureDataUrl) {
      const image = new Image();
      let complete!: () => void; loading.push(new Promise<void>(resolve => { complete = resolve; }));
      image.onload = () => {
        if (disposed || gl.isContextLost()) { complete(); return; }
        if (image.width > 4096 || image.height > 4096) { warn(`Текстура «${material.name}» слишком большая: максимум 4096 × 4096.`); complete(); return; }
        try { gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); batch.textured = true; draw(camera); } catch { warn(`Не удалось применить текстуру «${material.name}».`); } finally { complete(); }
      };
      image.onerror = () => { complete(); if (!disposed) warn(`Не удалось открыть текстуру «${material.name}». Используется базовый цвет.`); };
      image.src = material.textureDataUrl;
    }
    return batch;
  });
  function draw(next: Camera) {
    camera = next; if (disposed || gl!.isContextLost()) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), width = Math.max(1, Math.round(canvas.clientWidth * ratio)), height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const aspect = width / height, b = scene.bounds;
    const diagonal = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 1000;
    const radius = Math.max(2, diagonal * .59 + scene.ceilingHeight / 4000) / Math.min(1, aspect) / camera.zoom;
    gl!.viewport(0, 0, width, height); gl!.clearColor(.96, .94, .91, 1); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LEQUAL); gl!.disable(gl!.CULL_FACE); gl!.useProgram(program);
    gl!.uniform3f(locations.center, (b.minX + b.maxX) / 2000, scene.ceilingHeight / 4000, (b.minZ + b.maxZ) / 2000);
    gl!.uniform4f(locations.camera, camera.yaw, camera.pitch, radius, Math.max(10, diagonal * 3)); gl!.uniform1f(locations.aspect, aspect); gl!.uniform1i(locations.image, 0);
    for (const batch of batches) {
      gl!.bindBuffer(gl!.ARRAY_BUFFER, batch.buffer);
      for (let i = 0; i < 3; i++) { gl!.enableVertexAttribArray(attrs[i]); gl!.vertexAttribPointer(attrs[i], i === 2 ? 2 : 3, gl!.FLOAT, false, 32, [0, 12, 24][i]); }
      gl!.uniform3f(locations.color, batch.rgb[0], batch.rgb[1], batch.rgb[2]); gl!.uniform2f(locations.tile, batch.tile[0], batch.tile[1]); gl!.uniform1i(locations.textured, batch.textured ? 1 : 0);
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, batch.texture); gl!.drawArrays(gl!.TRIANGLES, 0, batch.count);
    }
  }
  return { draw, ready: Promise.all(loading), destroy() { if (disposed) return; disposed = true; for (const b of buffers) gl.deleteBuffer(b); for (const t of textures) gl.deleteTexture(t); for (const s of shaders) gl.deleteShader(s); gl.deleteProgram(program); } };
}
