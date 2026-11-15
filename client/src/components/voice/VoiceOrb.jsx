import { Component, memo, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const vertexShader = `
  uniform float uTime;
  uniform float uAudio;
  uniform float uMotion;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vRipple;
  void main() {
    vec3 p = position;
    float wave = sin(p.y * 5.0 + uTime * 0.7) * cos(p.x * 4.0 - uTime * 0.5);
    float ripple = wave * (0.018 + uAudio * 0.13) + sin(p.z * 7.0 + uTime * 0.35) * 0.012 * uMotion;
    p += normal * ripple;
    vRipple = ripple;
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(p, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = `
  uniform float uTime;
  uniform float uAudio;
  uniform vec3 uTint;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying float vRipple;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(-vPosition);
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
    float inner = 0.5 + 0.5 * sin(vPosition.y * 3.0 + uTime * 0.55 + vRipple * 24.0);
    vec3 deep = vec3(0.012, 0.075, 0.052);
    vec3 emerald = uTint * (0.64 + inner * 0.3);
    vec3 glass = mix(deep, emerald, 0.55 + inner * 0.23);
    glass += vec3(0.48, 0.82, 0.57) * fresnel * (0.48 + uAudio * 0.9);
    float highlight = pow(max(dot(reflect(-viewDir, n), normalize(vec3(-0.4, 0.7, 1.0))), 0.0), 24.0);
    glass += vec3(0.78, 1.0, 0.83) * highlight * 0.7;
    gl_FragColor = vec4(glass, 0.97);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function OrbMesh({ state, stream }) {
  const orbRef = useRef();
  const ringsRef = useRef();
  const pointsRef = useRef();
  const analyserRef = useRef(null);
  const audioDataRef = useRef(null);
  const audioLevelRef = useRef(0);
  const targetTint = useMemo(() => new THREE.Color('#3ca977'), []);
  const stateColor = useMemo(() => new THREE.Color('#3ca977'), []);
  const shaderUniforms = useMemo(() => ({ uTime: { value: 0 }, uAudio: { value: 0 }, uMotion: { value: 1 }, uTint: { value: new THREE.Color('#3ca977') } }), []);

  useEffect(() => {
    if (!stream) return undefined;
    let context;
    let source;
    try {
      context = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = context.createAnalyser();
      analyser.fftSize = 128;
      source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      analyserRef.current = analyser;
      audioDataRef.current = new Uint8Array(analyser.fftSize);
    } catch {
      context?.close().catch(() => {});
    }
    return () => {
      analyserRef.current = null;
      audioDataRef.current = null;
      source?.disconnect();
      if (context && context.state !== 'closed') context.close().catch(() => {});
    };
  }, [stream]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const material = orbRef.current?.material;
    if (!material) return;
    let raw = 0;
    if (analyserRef.current && audioDataRef.current) {
      analyserRef.current.getByteTimeDomainData(audioDataRef.current);
      let energy = 0;
      for (const value of audioDataRef.current) energy += ((value - 128) / 128) ** 2;
      raw = Math.min(1, Math.sqrt(energy / audioDataRef.current.length) * 2.8);
    }
    audioLevelRef.current = THREE.MathUtils.damp(audioLevelRef.current, raw, 7, delta);

    const active = ['listening', 'speaking'].includes(state);
    const researching = ['processing', 'memory', 'searching', 'researching'].includes(state);
    const paused = state === 'paused';
    const error = state === 'error';
    targetTint.set(error ? '#b76d59' : researching ? '#72936d' : paused ? '#829b82' : active ? '#56d392' : '#3ca977');
    stateColor.lerp(targetTint, 1 - Math.exp(-delta * 2.2));
    material.uniforms.uTime.value = t;
    material.uniforms.uAudio.value = audioLevelRef.current;
    material.uniforms.uTint.value.copy(stateColor);
    material.uniforms.uMotion.value = paused ? 0.15 : error ? 0.2 : 1;
    const breath = paused ? 1 : 1 + Math.sin(t * (researching ? 1.1 : 0.7)) * (active ? 0.025 : 0.012);
    const response = active ? audioLevelRef.current * 0.07 : 0;
    orbRef.current.scale.setScalar(breath + response);
    orbRef.current.rotation.y += delta * (researching ? 0.24 : 0.1 + audioLevelRef.current * 0.18);
    orbRef.current.rotation.x = Math.sin(t * 0.2) * 0.06;
    if (ringsRef.current) {
      ringsRef.current.rotation.z += delta * (researching ? 0.12 : 0.055);
      ringsRef.current.rotation.x = Math.sin(t * 0.16) * 0.12;
      ringsRef.current.children.forEach((ring, i) => { ring.material.opacity = THREE.MathUtils.damp(ring.material.opacity, researching ? 0.37 : active ? 0.29 : 0.2, 2, delta); });
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * (active ? 0.08 + audioLevelRef.current * 0.24 : 0.035);
      pointsRef.current.position.y = Math.sin(t * 0.36) * 0.025;
    }
  });

  const particles = useMemo(() => {
    const positions = new Float32Array(32 * 3);
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.399;
      const radius = 1.28 + ((i * 17) % 13) / 35;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle * 0.73) * 0.72;
      positions[i * 3 + 2] = Math.sin(angle) * radius * 0.58;
    }
    return positions;
  }, []);

  return <>
    <group ref={ringsRef}>
      <mesh rotation={[0.8, 0.15, 0.15]}><torusGeometry args={[1.08, 0.006, 8, 128]} /><meshBasicMaterial color="#bbefcf" transparent opacity={0.2} /></mesh>
      <mesh rotation={[1.3, 0.25, 1.0]}><torusGeometry args={[1.18, 0.004, 8, 128]} /><meshBasicMaterial color="#a6d9b6" transparent opacity={0.16} /></mesh>
      <mesh rotation={[0.25, 1.25, 0.5]}><torusGeometry args={[1.27, 0.003, 8, 128]} /><meshBasicMaterial color="#d5f4df" transparent opacity={0.12} /></mesh>
    </group>
    <mesh ref={orbRef}>
      <sphereGeometry args={[0.86, 80, 80]} />
      <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={shaderUniforms} />
    </mesh>
    <mesh position={[-0.28, 0.42, 0.68]}><sphereGeometry args={[0.12, 24, 24]} /><meshBasicMaterial color="#e5ffec" transparent opacity={0.55} /></mesh>
    <points ref={pointsRef}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[particles, 3]} /></bufferGeometry>
      <pointsMaterial color="#c4efd0" size={0.018} transparent opacity={0.62} sizeAttenuation depthWrite={false} />
    </points>
    <pointLight position={[-2, 2, 3]} color="#8ff0b2" intensity={2.1} distance={6} />
    <pointLight position={[2, -1.5, 1]} color="#d6edb1" intensity={1.1} distance={5} />
    <ambientLight intensity={0.35} />
  </>;
}

class OrbErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className={`orb-css-fallback ${this.props.state}`} aria-hidden="true" /> : this.props.children; }
}

const VoiceOrb = memo(function VoiceOrb({ state = 'idle', stream = null }) {
  return <OrbErrorBoundary state={state}><Canvas dpr={[1, 1.35]} camera={{ position: [0, 0, 3.7], fov: 36 }} gl={{ alpha: true, antialias: true, powerPreference: 'low-power', stencil: false, depth: true }} aria-hidden="true">
    <OrbMesh state={state} stream={stream} />
  </Canvas></OrbErrorBoundary>;
});

export default VoiceOrb;
