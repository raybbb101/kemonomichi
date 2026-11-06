// HD-2D レンダラー：3D の地形・光・影の中にドット絵スプライトを立たせ、
// ブルーム + ティルトシフト(被写界深度) + ビネットで仕上げる。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/addons/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/addons/shaders/VerticalTiltShiftShader.js';
import { WALL, PIT, WATER, ROCK, rng } from './stage.js';
import { tileTexture, propSprite, glowTexture, mix } from './sprites.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVig: { value: 0.9 }, uSat: { value: 1.12 }, uTint: { value: new THREE.Color(1.03, 1.0, 0.96) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uVig; uniform float uSat; uniform vec3 uTint; varying vec2 vUv;
    void main(){ vec4 c=texture2D(tDiffuse,vUv); float l=dot(c.rgb,vec3(0.299,0.587,0.114)); c.rgb=mix(vec3(l),c.rgb,uSat)*uTint;
      vec2 d=vUv-0.5; float v=1.0-dot(d,d)*uVig; c.rgb*=clamp(v,0.0,1.0); gl_FragColor=c; }`,
};

const texCache = new WeakMap();
export function canvasTex(cv) {
  if (texCache.has(cv)) return texCache.get(cv);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(cv, t); return t;
}
const depthCache = new WeakMap();
function depthMat(tex) {
  if (!depthCache.has(tex)) depthCache.set(tex, new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5, side: THREE.DoubleSide }));
  return depthCache.get(tex);
}
const planeGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
    this.camOff = new THREE.Vector3(0, 12.5, 15.5);
    this.camTarget = new THREE.Vector3(10, 0, 9);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true; this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.82); this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader); this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.tiltH.uniforms.r.value = this.tiltV.uniforms.r.value = 0.48;
    this.composer.addPass(this.tiltH); this.composer.addPass(this.tiltV);
    this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());

    this.stageGroup = new THREE.Group(); this.scene.add(this.stageGroup);
    this.ents = new Map(); this.objs = new Map(); this.projs = new Map();
    this.fx = []; this.time = 0; this.shakeT = 0; this.shakeA = 0;
    this.resize(); addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.tiltH.uniforms.h.value = 1.6 / w; this.tiltV.uniforms.v.value = 1.6 / h;
    this.bloom.resolution.set(w / 2, h / 2);
  }

  // ---------- ステージ構築 ----------
  buildStage(st) {
    this.clearStage();
    this.stage = st;
    const B = st.biome, g = this.stageGroup;
    this.scene.background = new THREE.Color(B.sky);
    this.scene.fog = new THREE.Fog(B.fog, 26, 55);
    this.hemi.color.set(mix(B.sky, '#ffffff', 0.4)); this.hemi.groundColor.set(B.side[0]); this.hemi.intensity = B.amb * 1.6;
    this.sun.color.set(B.sun); this.sun.intensity = B.sunI;

    const mat = (cv) => new THREE.MeshLambertMaterial({ map: canvasTex(cv) });
    const grassSide = Object.assign([...B.side], { grass: B.top[0] });
    const capMats = [mat(tileTexture(grassSide, 'grassside', 1)), mat(tileTexture(grassSide, 'grassside', 1)), mat(tileTexture(B.top, 'top', 1)), mat(tileTexture(B.side, 'side', 1)), mat(tileTexture(grassSide, 'grassside', 1)), mat(tileTexture(grassSide, 'grassside', 1))];
    const fillMat = mat(tileTexture(B.side, 'side', 2));
    const rockCols = [B.rock, mix(B.rock, '#000000', 0.25), mix(B.rock, '#ffffff', 0.2)];
    const rockMat = mat(tileTexture(rockCols, 'stone', 3));
    const caps = [], fills = [], rocks = [];
    const r = rng(st.seed + 5);
    const { W, H, T, Ht } = st;
    const nearPit = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => { const xx = x + a, yy = y + b; return xx >= 0 && yy >= 0 && xx < W && yy < H && (T[yy * W + xx] === PIT || T[yy * W + xx] === WATER); });
    for (let y = -6; y < H + 6; y++) for (let x = -7; x < W + 7; x++) {
      const inside = x >= 0 && y >= 0 && x < W && y < H;
      let t = WALL, h = 0;
      if (inside) { t = T[y * W + x]; h = Ht[y * W + x]; }
      else { const d = Math.max(-x, -y, x - W + 1, y - H + 1); h = y >= H ? 1 : Math.min(5, 3 + Math.floor(d / 2) + (r() < 0.3 ? 1 : 0)); if (d > 4 && y > H) continue; }
      const tint = 0.9 + r() * 0.12;
      if (t === WALL) {
        caps.push([x, h - 0.5, y, tint]);
        for (let k = h - 1; k >= 0; k--) fills.push([x, k - 0.5, y, tint * (0.75 + 0.25 * (k / h))]);
        if (inside && r() < 0.3 && h >= 1 && !st.decor.some((d) => Math.floor(d.x) === x && Math.floor(d.z) === y)) {} // 余白
        if (!inside && h >= 2 && y < H && r() < 0.18) st.decor.push({ kind: B.deco[0], x: x + 0.5, z: y + 0.5, y: h, v: Math.floor(r() * 3), outer: true });
      } else if (t === PIT) {
        // 何も置かない（奈落）
      } else if (t === WATER) {
        fills.push([x, -1.5, y, 0.7]);
      } else {
        caps.push([x, -0.5, y, tint]);
        if (nearPit(x, y)) for (let k = 1; k < 5; k++) fills.push([x, -0.5 - k, y, Math.max(0.3, 0.85 - k * 0.15)]);
        if (t === ROCK) rocks.push([x, h, y, tint]);
      }
    }
    const inst = (list, geo, mats, shadow = true) => {
      const m = new THREE.InstancedMesh(geo, mats, list.length);
      const o = new THREE.Object3D(), c = new THREE.Color();
      list.forEach(([x, y, z, tint, sy], i) => { o.position.set(x + 0.5, y, z + 0.5); o.scale.set(1, sy || 1, 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.setScalar(tint)); });
      m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
    };
    const box = new THREE.BoxGeometry(1, 1, 1);
    inst(caps, box, capMats);
    inst(fills, box, fillMat);
    if (rocks.length) inst(rocks.map(([x, h, y, t]) => [x, h / 2, y, t, h]), box, rockMat);

    // 水面
    const waterTiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (T[y * W + x] === WATER) waterTiles.push([x, -0.18, y, 1]);
    if (waterTiles.length) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 32; const ctx = cv.getContext('2d');
      const base = B.name.includes('洞窟') ? '#3a6aa8' : '#3f9ad0';
      ctx.fillStyle = base; ctx.fillRect(0, 0, 32, 32);
      for (let i = 0; i < 26; i++) { ctx.fillStyle = i % 3 ? mix(base, '#ffffff', 0.25) : '#e8fbff'; ctx.fillRect(Math.floor(r() * 32), Math.floor(r() * 32), 2 + Math.floor(r() * 3), 1); }
      const wt = canvasTex(cv); wt.wrapS = wt.wrapT = THREE.RepeatWrapping;
      this.waterTex = wt;
      const wm = new THREE.MeshLambertMaterial({ map: wt, transparent: true, opacity: 0.82, emissive: new THREE.Color(base), emissiveIntensity: 0.25 });
      const m = inst(waterTiles, flatGeo, wm, false); m.receiveShadow = true;
    }
    // 奈落の底
    const voidM = new THREE.Mesh(new THREE.PlaneGeometry(W + 20, H + 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x05030a }));
    voidM.position.set(W / 2, -5.5, H / 2); g.add(voidM);

    // 飾り（木・草・花など）
    this.lights = [];
    const tufts = [];
    for (const d of st.decor) {
      if (d.kind === 'tuft') { tufts.push(d); continue; }
      const cv = propSprite(d.kind === 'snowpine' ? 'pine' : d.kind, d.v);
      const sz = d.kind === 'tree' || d.kind === 'autumn' || d.kind === 'palm' || d.kind === 'fruittree' ? 3.2 + (d.v % 2) * 0.4 : d.kind === 'pine' ? 3.4 : d.kind === 'torch' ? 0.9 : d.kind === 'crystal' ? 1.1 : cv.width / 14;
      this.addBillboard(cv, d.x, d.y, d.z, sz, { shadow: d.kind !== 'flower', lean: 0.15 });
      if (d.light) this.addLight('#ff9a4a', d.x, 1.2, d.z + 0.3, 2.2, 6, true);
      if (d.kind === 'crystal' && !d.outer && r() < 0.35) this.addLight(['#9ad8ff', '#d0a0ff', '#7affd8'][d.v % 3], d.x, 0.8, d.z, 1.2, 4);
    }
    if (tufts.length) {
      const tex = canvasTex(propSprite('tuft'));
      const m = new THREE.InstancedMesh(planeGeo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, color: new THREE.Color(B.top[1]).multiplyScalar(1.6) }), tufts.length);
      const o = new THREE.Object3D();
      tufts.forEach((d, i) => { o.position.set(d.x, 0, d.z); o.rotation.set(-0.3, 0, 0); o.scale.set(0.5, 0.38, 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      g.add(m);
    }
    this.buildParticles(B);
  }

  addBillboard(cv, x, y, z, size, { shadow = true, lean = 0.3 } = {}) {
    const tex = canvasTex(cv);
    const m = new THREE.Mesh(planeGeo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.12 }));
    m.scale.set(size * (cv.width / cv.height), size, 1); m.position.set(x, y, z); m.rotation.x = -lean;
    m.castShadow = shadow; m.customDepthMaterial = depthMat(tex);
    this.stageGroup.add(m); return m;
  }

  addLight(col, x, y, z, intensity, dist, flicker = false) {
    if (this.lights.length > 7) return null;
    const l = new THREE.PointLight(col, intensity, dist, 1.6); l.position.set(x, y, z); l.userData = { base: intensity, flicker };
    this.stageGroup.add(l); this.lights.push(l);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(glowTexture(col)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.position.set(x, y, z); glow.scale.setScalar(1.2); this.stageGroup.add(glow);
    return l;
  }

  buildParticles(B) {
    const n = 160, pos = new Float32Array(n * 3), st = this.stage;
    for (let i = 0; i < n; i++) { pos[i * 3] = Math.random() * st.W; pos[i * 3 + 1] = Math.random() * 5; pos[i * 3 + 2] = Math.random() * st.H; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = { pollen: '#fff3b0', motes: '#9ad8ff', leaves: '#ff9a4a', snow: '#ffffff', fireflies: '#d8ff7a' }[B.particles];
    const m = new THREE.Points(geo, new THREE.PointsMaterial({ map: canvasTex(glowTexture(col)), size: B.particles === 'snow' ? 0.22 : 0.16, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85 }));
    m.userData.kind = B.particles; this.particles = m; this.stageGroup.add(m);
  }

  clearStage() {
    for (const e of this.ents.values()) this.scene.remove(e.root);
    for (const o of this.objs.values()) this.scene.remove(o.root);
    for (const p of this.projs.values()) this.scene.remove(p);
    this.ents.clear(); this.objs.clear(); this.projs.clear();
    this.stageGroup.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.geometry !== planeGeo && o.geometry !== flatGeo && o.geometry.dispose?.(); } });
    this.scene.remove(this.stageGroup); this.stageGroup = new THREE.Group(); this.scene.add(this.stageGroup);
    for (const f of this.fx) this.scene.remove(f.obj); this.fx = [];
  }

  // ---------- エンティティ（スプライト）----------
  // spec: { id, cv, x, z, y, face, size, flash, down, ghost, hover, walking, attack, shadowBlob }
  syncEntities(list) {
    const seen = new Set();
    for (const s of list) {
      seen.add(s.id);
      let e = this.ents.get(s.id);
      if (!e || e.cv !== s.cv) {
        if (e) this.scene.remove(e.root);
        const tex = canvasTex(s.cv);
        const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.28, transparent: false });
        const mesh = new THREE.Mesh(planeGeo, mat); mesh.castShadow = true; mesh.customDepthMaterial = depthMat(tex);
        const blob = new THREE.Mesh(flatGeo, new THREE.MeshBasicMaterial({ map: canvasTex(glowTexture('#000000')), transparent: true, opacity: 0.35, depthWrite: false, color: 0x000000 }));
        blob.position.y = 0.02;
        const root = new THREE.Group(); root.add(mesh, blob); this.scene.add(root);
        e = { root, mesh, blob, mat, cv: s.cv, phase: Math.random() * 10, flip: 1, x: s.x, z: s.z };
        this.ents.set(s.id, e);
      }
      const t = this.time + e.phase;
      e.root.position.set(s.x, 0, s.z);
      if (s.face) e.flip = s.face > 0 ? 1 : -1;
      const size = s.size || 1.5;
      let bob = 0, sx = 1, sy = 1, rotZ = 0;
      if (s.walking) { bob = Math.abs(Math.sin(t * 13)) * 0.09 * size; sy = 1 - Math.sin(t * 26) * 0.03; }
      else { sy = 1 + Math.sin(t * 3) * 0.025; }
      if (s.hover) { bob += 0.5 + Math.sin(t * 4) * 0.12; sx = 1 - Math.abs(Math.sin(t * 16)) * (s.flap ? 0.35 : 0); }
      if (s.attack) { sx *= 1.15; sy *= 0.92; }
      if (s.down) { rotZ = Math.PI / 2 * e.flip * 0.92; bob = 0.1; }
      e.mesh.position.set(s.attack ? e.flip * 0.12 : 0, (s.y || 0) + bob, 0);
      e.mesh.scale.set(size * sx * e.flip, size * sy, 1);
      e.mesh.rotation.set(s.down ? -Math.PI / 2.4 : -0.32, 0, rotZ);
      e.blob.scale.setScalar(size * 0.8 * (s.hover || s.y > 0.2 ? 0.7 : 1));
      e.blob.visible = !!(s.hover || (s.y || 0) > 0.05);
      const fl = s.flash > 0;
      e.mat.emissive.set(fl ? 0xffffff : s.tint || 0xffffff); e.mat.emissiveIntensity = fl ? 1.6 : s.tint ? 0.6 : 0.28;
      e.mat.color.set(s.down ? 0x8888aa : s.sleep ? 0xaaaaee : 0xffffff);
      e.mesh.visible = !s.ghost || Math.floor(this.time * 20) % 2 === 0;
    }
    for (const [id, e] of this.ents) if (!seen.has(id)) { this.scene.remove(e.root); this.ents.delete(id); }
  }

  // ---------- 置物（宝箱・仕掛け・商人など）----------
  syncObjects(list) {
    const seen = new Set();
    for (const o of list) {
      seen.add(o.id);
      let v = this.objs.get(o.id);
      const key = o.kind + ':' + (o.state || '');
      if (!v || v.key !== key) {
        if (v) this.scene.remove(v.root);
        v = this.makeObject(o); v.key = key; this.objs.set(o.id, v);
      }
      if (o.kind === 'boulder') v.root.position.set(o.x, 0, o.z);
      if (v.anim) v.anim(this.time);
    }
    for (const [id, v] of this.objs) if (!seen.has(id)) { this.scene.remove(v.root); this.objs.delete(id); }
  }

  makeObject(o) {
    const root = new THREE.Group(); root.position.set(o.x, 0, o.z); this.scene.add(root);
    const v = { root };
    const bb = (cv, size, y = 0, lean = 0.3) => {
      const tex = canvasTex(cv);
      const m = new THREE.Mesh(planeGeo, new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25 }));
      m.scale.set(size * cv.width / cv.height, size, 1); m.position.y = y; m.rotation.x = -lean; m.castShadow = true; m.customDepthMaterial = depthMat(tex);
      root.add(m); return m;
    };
    const glow = (col, size, y = 0.6, op = 0.8) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(glowTexture(col)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: op })); s.position.y = y; s.scale.setScalar(size); root.add(s); return s; };
    switch (o.kind) {
      case 'portal': {
        const open = o.state === 'open';
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.16, 8, 24), new THREE.MeshLambertMaterial({ color: 0x8a8296, emissive: open ? 0x66ccff : 0x222233, emissiveIntensity: open ? 1.6 : 0.4 }));
        ring.position.y = 1.05; ring.castShadow = true; root.add(ring);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 0.2, 16), new THREE.MeshLambertMaterial({ color: 0x8a8296 })); base.position.y = 0.1; base.receiveShadow = true; root.add(base);
        if (open) {
          const disc = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
          disc.position.y = 1.05; root.add(disc);
          const g1 = glow('#7fd8ff', 3.2, 1.0, 0.7);
          const l = new THREE.PointLight('#7fd8ff', 3, 7, 1.6); l.position.y = 1.2; root.add(l);
          v.anim = (t) => { ring.rotation.z = t * 0.6; disc.material.opacity = 0.45 + Math.sin(t * 4) * 0.15; g1.scale.setScalar(3 + Math.sin(t * 3) * 0.3); };
        }
        break;
      }
      case 'chest': { bb(propSprite(o.state === 'open' ? 'chestopen' : 'chest'), 0.85, o.bonus === 'water' ? -0.1 : 0); if (o.state !== 'open') { const s = glow('#ffe9a0', 0.9, 0.5, 0.5); v.anim = (t) => s.material.opacity = 0.3 + Math.sin(t * 3) * 0.2; } break; }
      case 'dig': { if (o.state !== 'open') { const m = bb(propSprite('dig'), 0.5, 0, 1.2); const s = glow('#fff7a0', 0.6, 0.3, 0.5); v.anim = (t) => s.material.opacity = 0.25 + Math.abs(Math.sin(t * 2)) * 0.4; } else bb(propSprite('dig'), 0.4, 0, 1.3); break; }
      case 'hole': { bb(propSprite('hole'), 1.1, 0, 0.0); break; }
      case 'fruittree': { bb(propSprite(o.state === 'open' ? 'tree' : 'fruittree', 7), 3.4); break; }
      case 'plate': { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 16), new THREE.MeshLambertMaterial({ color: 0x8a8fa0, emissive: o.state === 'on' || o.state === 'done' ? 0x66ffaa : 0x000000, emissiveIntensity: 0.8 })); m.position.y = 0.06; m.receiveShadow = true; root.add(m); if (o.state === 'on' || o.state === 'done') glow('#66ffaa', 1.4, 0.3, 0.6); break; }
      case 'boulder': { bb(propSprite('boulder'), 1.0, 0, 0.3); break; }
      case 'pillar': {
        bb(propSprite('pillar'), 1.9);
        const lit = o.state === 'lit' || o.state === 'done';
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), new THREE.MeshLambertMaterial({ color: o.col, emissive: o.col, emissiveIntensity: lit ? 2.2 : 0.35 }));
        gem.position.y = 2.15; root.add(gem);
        if (lit) { glow(o.col, 1.6, 2.15, 0.9); }
        v.anim = (t) => { gem.rotation.y = t * 1.5; gem.position.y = 2.15 + Math.sin(t * 2) * 0.06; };
        break;
      }
      case 'tablet': { bb(propSprite('tablet'), 1.3); if (o.state === 'done') glow('#ffe9a0', 1.8, 0.8, 0.5); break; }
      case 'altar': { bb(propSprite('altar'), 0.9); const s = glow(o.state === 'done' ? '#66ffaa' : o.state === 'bad' ? '#ff6666' : '#ffe9a0', 0.9, 0.75, 0.7); v.anim = (t) => s.position.y = 0.75 + Math.sin(t * 2) * 0.05; break; }
      case 'merchant': { const m = bb(o.cv, 1.6, 0, 0.3); v.anim = (t) => m.scale.y = 1.6 * (1 + Math.sin(t * 2.5) * 0.02); break; }
      case 'campfire': {
        const logs = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.15, 8), new THREE.MeshLambertMaterial({ color: 0x5a3a28 })); logs.position.y = 0.08; root.add(logs);
        const f = glow('#ff9a3a', 1.5, 0.5, 0.9), f2 = glow('#ffe07a', 0.8, 0.45, 0.9);
        const l = new THREE.PointLight('#ff9a4a', 3.5, 9, 1.5); l.position.y = 0.8; root.add(l);
        v.anim = (t) => { const k = 1 + Math.sin(t * 13) * 0.1 + Math.sin(t * 7.3) * 0.08; f.scale.setScalar(1.5 * k); f2.scale.setScalar(0.8 * k); l.intensity = 3.5 * k; };
        break;
      }
      case 'fusion': {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.35, 6), new THREE.MeshLambertMaterial({ color: 0x6a6280, emissive: 0x8a5aff, emissiveIntensity: 0.3 })); base.position.y = 0.17; base.castShadow = true; root.add(base);
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 1), new THREE.MeshLambertMaterial({ color: 0xd0b0ff, emissive: 0xb080ff, emissiveIntensity: 1.8 })); root.add(orb);
        const gg = glow('#c8a0ff', 2.6, 1.2, 0.8); const l = new THREE.PointLight('#b080ff', 3, 7, 1.5); l.position.y = 1.2; root.add(l);
        v.anim = (t) => { orb.position.y = 1.2 + Math.sin(t * 2) * 0.12; orb.rotation.y = t; gg.scale.setScalar(2.6 + Math.sin(t * 3) * 0.3); };
        break;
      }
    }
    return v;
  }

  // ---------- 弾 ----------
  syncProjectiles(list) {
    const seen = new Set();
    const cols = { nut: '#c9a36a', poison: '#8fe07a', bubble: '#9fe8ff', dust: '#e7c6ff', claw: '#b9a3ff', enemy: '#ff5a5a', spore: '#c86aff', fire: '#ff8a3a', feather: '#ffe9a0' };
    for (const p of list) {
      seen.add(p.id);
      let s = this.projs.get(p.id);
      if (!s) {
        const c = cols[p.kind] || '#ffffff';
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(glowTexture(c)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
        s.scale.setScalar(p.kind === 'fire' ? 1.1 : p.kind === 'enemy' || p.kind === 'spore' ? 0.8 : 0.65); this.scene.add(s); this.projs.set(p.id, s);
      }
      s.position.set(p.x, 0.6, p.z);
    }
    for (const [id, s] of this.projs) if (!seen.has(id)) { this.scene.remove(s); this.projs.delete(id); }
  }

  // ---------- エフェクト ----------
  addFx(obj, life, update) { this.scene.add(obj); this.fx.push({ obj, life, max: life, update }); }

  spawnFx(e) {
    const col = new THREE.Color(e.col || '#ffffff');
    const add = (m) => new THREE.MeshBasicMaterial({ color: col, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, opacity: m ?? 0.9 });
    switch (e.k) {
      case 'slash': {
        const arc = Math.min(Math.PI * 2, (e.arc || 120) * Math.PI / 180);
        const m = new THREE.Mesh(new THREE.RingGeometry(e.r * 0.45, e.r, 20, 1, -arc / 2, arc), add(0.85));
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.atan2(-e.dz, e.dx); m.position.set(e.x, 0.35, e.z);
        this.addFx(m, 0.18, (t, k) => { m.material.opacity = 0.85 * k; m.scale.setScalar(0.8 + (1 - k) * 0.35); });
        break;
      }
      case 'ring': case 'boom': case 'wave': case 'mist': case 'dream': case 'coil': case 'slashring': case 'banana': case 'howl': case 'shield': case 'heal': {
        const r = e.r || 2;
        const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), add(0.9));
        m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.12, e.z);
        const life = e.k === 'mist' || e.k === 'dream' ? 0.7 : 0.4;
        this.addFx(m, life, (t, k) => { m.scale.setScalar(r * (0.2 + 0.8 * Math.pow(1 - k, 0.4))); m.material.opacity = 0.9 * k; });
        const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), add(0.3)); disc.rotation.x = -Math.PI / 2; disc.position.set(e.x, 0.1, e.z);
        this.addFx(disc, life, (t, k) => { disc.scale.setScalar(r * (1 - k * 0.3)); disc.material.opacity = 0.35 * k; });
        const n = e.k === 'boom' || e.k === 'wave' ? 18 : e.k === 'heal' || e.k === 'howl' || e.k === 'shield' ? 14 : 10;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * r;
          const up = e.k === 'heal' || e.k === 'howl' || e.k === 'shield' || e.k === 'dream';
          this.particle(e.x + Math.cos(a) * d * (up ? 1 : 0.3), 0.3, e.z + Math.sin(a) * d * (up ? 1 : 0.3), up ? 0 : Math.cos(a) * 4, up ? 2.5 + Math.random() * 2 : 2 + Math.random() * 3, up ? 0 : Math.sin(a) * 4, e.col, up ? 0.9 : 0.5, up ? 0 : 9);
        }
        if (e.k === 'boom' || e.k === 'wave') { this.flashLight(e.x, e.z, e.col, 4); this.shake(0.18); }
        break;
      }
      case 'tele': {
        const red = new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
        let geo, fill;
        if (e.shape === 'line') { geo = new THREE.PlaneGeometry(e.len, e.w).translate(e.len / 2, 0, 0); }
        else if (e.shape === 'cone') { geo = new THREE.CircleGeometry(e.r, 24, -0.5, 1.0); }
        else geo = new THREE.CircleGeometry(e.r, 32);
        const m = new THREE.Mesh(geo, red); m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.08, e.z);
        if (e.dx !== undefined) m.rotation.z = Math.atan2(-e.dz, e.dx);
        fill = new THREE.Mesh(geo, red.clone()); fill.material.opacity = 0.35; fill.rotation.copy(m.rotation); fill.position.copy(m.position); fill.position.y = 0.09;
        this.addFx(m, e.dur, (t, k) => { m.material.opacity = 0.18 + 0.12 * Math.sin(t * 30); });
        this.addFx(fill, e.dur, (t, k) => { const s = 1 - k; if (e.shape === 'line') fill.scale.set(s, 1, 1); else fill.scale.setScalar(Math.max(0.01, s)); });
        break;
      }
      case 'hit': for (let i = 0; i < 6; i++) { const a = Math.random() * Math.PI * 2; this.particle(e.x, 0.6, e.z, Math.cos(a) * 5, 2 + Math.random() * 2, Math.sin(a) * 5, e.col || '#fff3c0', 0.35, 12); } break;
      case 'poof': for (let i = 0; i < 12; i++) { const a = Math.random() * Math.PI * 2; this.particle(e.x, 0.5, e.z, Math.cos(a) * 2.5, 1 + Math.random() * 2, Math.sin(a) * 2.5, e.col || '#e8e0f0', 0.6, 2, 1.0); } break;
      case 'coin': for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2; this.particle(e.x, 0.6, e.z, Math.cos(a) * 2, 5, Math.sin(a) * 2, '#ffd84a', 0.7, 14); } break;
      case 'level': for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; this.particle(e.x + Math.cos(a) * 0.7, 0.2, e.z + Math.sin(a) * 0.7, 0, 3 + Math.random() * 2, 0, '#fff27a', 1.0, 0); } this.flashLight(e.x, e.z, '#fff27a', 3); break;
      case 'fusion': for (let i = 0; i < 60; i++) { const a = Math.random() * Math.PI * 2; this.particle(e.x, 0.5, e.z, Math.cos(a) * 6, 2 + Math.random() * 6, Math.sin(a) * 6, i % 2 ? '#c8a0ff' : '#7af7ff', 1.3, 4); } this.flashLight(e.x, e.z, '#c8a0ff', 10); this.shake(0.4); break;
      case 'spawn': { const m = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.6, 24), new THREE.MeshBasicMaterial({ color: 0xa040ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(e.x, 0.1, e.z); this.addFx(m, 0.8, (t, k) => { m.scale.setScalar(1 + (1 - k)); m.material.opacity = k; }); break; }
    }
  }

  particle(x, y, z, vx, vy, vz, col = '#ffffff', life = 0.5, grav = 9, size = 0.35) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(glowTexture(col)), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.set(x, y, z); s.scale.setScalar(size);
    const v = new THREE.Vector3(vx, vy, vz);
    this.addFx(s, life, (t, k, dt) => { v.y -= grav * dt; s.position.addScaledVector(v, dt); s.material.opacity = k; s.scale.setScalar(size * (0.4 + k * 0.6)); });
  }

  flashLight(x, z, col = '#ffffff', i = 4) {
    const l = new THREE.PointLight(col, i, 8, 1.5); l.position.set(x, 1.2, z);
    this.addFx(l, 0.25, (t, k) => { l.intensity = i * k; });
  }

  shake(a) { this.shakeA = Math.max(this.shakeA, a); this.shakeT = 0.3; }

  // ---------- 毎フレーム ----------
  render(dt, focus) {
    this.time += dt;
    if (focus && this.stage) {
      const st = this.stage;
      const fx = Math.min(Math.max(focus.x, 9), st.W - 9), fz = Math.min(Math.max(focus.z, 5.5), st.H - 4.5);
      const k = 1 - Math.pow(0.002, dt);
      this.camTarget.x += (fx - this.camTarget.x) * k; this.camTarget.z += (fz - this.camTarget.z) * k;
    }
    const cam = this.camera;
    cam.position.copy(this.camTarget).add(this.camOff);
    if (this.shakeT > 0) { this.shakeT -= dt; cam.position.x += (Math.random() - 0.5) * this.shakeA; cam.position.y += (Math.random() - 0.5) * this.shakeA; if (this.shakeT <= 0) this.shakeA = 0; }
    cam.lookAt(this.camTarget.x, 0.6, this.camTarget.z);
    this.sun.position.set(this.camTarget.x - 9, 16, this.camTarget.z + 7); this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);

    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.obj); f.obj.geometry?.dispose?.(); f.obj.material?.dispose?.(); this.fx.splice(i, 1); continue; }
      f.update(this.time, f.life / f.max, dt);
    }
    if (this.waterTex) { this.waterTex.offset.x = (this.time * 0.03) % 1; this.waterTex.offset.y = Math.sin(this.time * 0.5) * 0.02; }
    for (const l of this.lights || []) if (l.userData.flicker) l.intensity = l.userData.base * (1 + Math.sin(this.time * 11 + l.position.x) * 0.12 + Math.sin(this.time * 17.3) * 0.06);
    if (this.particles) {
      const p = this.particles.geometry.attributes.position, kind = this.particles.userData.kind, st = this.stage;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (kind === 'snow') { y -= dt * 0.8; x += Math.sin(this.time + i) * dt * 0.3; }
        else if (kind === 'leaves') { y -= dt * 0.5; x += dt * 0.6; }
        else { y += Math.sin(this.time * 0.7 + i) * dt * 0.2; x += Math.cos(this.time * 0.3 + i * 1.7) * dt * 0.25; }
        if (y < 0) y = 5; if (x > st.W) x = 0;
        p.setXYZ(i, x, y, z);
      }
      p.needsUpdate = true;
      if (kind === 'fireflies') this.particles.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.3;
    }
    this.composer.render(dt);
  }

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, vis: v.z < 1 };
  }
}
