import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import type { GroupProps } from "@react-three/fiber";
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture,
  RoundedBox,
  Torus
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
import { GestureRecognizer, FilesetResolver, DrawingUtils } from "@mediapipe/tasks-vision";

const TOTAL_NUMBERED_PHOTOS = 19;
const bodyPhotoPaths = [
  '/photos/top.jpg',
  ...Array.from({ length: TOTAL_NUMBERED_PHOTOS }, (_, i) => `/photos/${i + 1}.jpg`)
];

const CONFIG = {
  colors: {
    emerald: '#004225',
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'],
    borders: ['#FDF5E6', '#D4AF37', '#B22222', '#228B22'],
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 150000,
    ornaments: 20,
    elements: 300,
    lights: 300
  },
  tree: { height: 27, radius: 9 },
  photos: {

    body: bodyPhotoPaths
  }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0 },
  `uniform float uTime; uniform float uProgress; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (60.0 * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h / 2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  // const r = Math.random() * currentRadius;
  const noise = (Math.random() - 0.5) * 0.1;
  const r = Math.random() * currentRadius * (1 + noise);
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state }: { state: 'CHAOS' | 'FORMED' | 'CAROUSEL' }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const count = CONFIG.counts.foliage;
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = spherePoints[i * 3]; positions[i * 3 + 1] = spherePoints[i * 3 + 1]; positions[i * 3 + 2] = spherePoints[i * 3 + 2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i * 3] = tx; targetPositions[i * 3 + 1] = ty; targetPositions[i * 3 + 2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, []);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'CHAOS' ? 0 : 1;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

const PhotoOrnaments = ({ state, isSpinning }: { state: 'CHAOS' | 'FORMED' | 'CAROUSEL', isSpinning: boolean }) => {
  const textures = useTexture(CONFIG.photos.body);
  const count = CONFIG.counts.ornaments;
  const groupRef = useRef<THREE.Group>(null);

  const smoothRadius = useRef(25);
  const smoothHeight = useRef(5);
  const smoothScaleDivisor = useRef(28);

  // --- Component: Cặp Chuông ---
  const BellDecoration = ({ scale = 1 }) => {
    const goldMetal = <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.2} envMapIntensity={1.5} />;
    const redString = <meshStandardMaterial color="#B22222" roughness={0.9} />;

    const Bell = ({ position, rotation }: GroupProps) => (
      <group position={position} rotation={rotation}>
        {/* Thân chuông */}
        <mesh> <sphereGeometry args={[0.15, 16, 16]} /> {goldMetal} </mesh>
        {/* Cái khe bên dưới chuông (Giả bằng 1 khối đen nhỏ) */}
        <mesh position={[0, -0.14, 0]} scale={[1, 0.2, 1]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshBasicMaterial color="#330000" />
        </mesh>
      </group>
    );

    return (
      <group scale={[scale, scale, scale]}>
        {/* Nút buộc dây ở giữa */}
        <mesh position={[0, 0.15, 0]}> <sphereGeometry args={[0.06, 12, 12]} /> {redString} </mesh>
        {/* Hai quả chuông nghiêng 2 bên */}
        <Bell position={[-0.16, 0, 0]} rotation={[0, 0, Math.PI / 6]} />
        <Bell position={[0.16, 0, 0]} rotation={[0, 0, -Math.PI / 6]} />
      </group>
    );
  };

  // --- Component: Cành Holly Berry ---
  const HollyDecoration = ({ scale = 1 }) => {
    const berryMaterial = <meshStandardMaterial color="#D32F2F" roughness={0.3} metalness={0.2} />;
    const leafMaterial = <meshStandardMaterial color="#2E7D32" roughness={0.7} />;

    return (
      <group scale={[scale, scale, scale]}>
        {/* 3 Quả Berry đỏ */}
        <mesh position={[0, 0, 0.02]}> <sphereGeometry args={[0.08, 12, 12]} /> {berryMaterial} </mesh>
        <mesh position={[0.12, -0.05, 0.02]}> <sphereGeometry args={[0.07, 12, 12]} /> {berryMaterial} </mesh>
        <mesh position={[-0.1, -0.04, 0.02]}> <sphereGeometry args={[0.07, 12, 12]} /> {berryMaterial} </mesh>

        {/* 2 Chiếc lá (Dùng hình cầu dẹt và kéo dài) */}
        <group position={[0.15, 0.1, 0]} rotation={[0, 0, Math.PI / 4]}>
          <mesh scale={[1, 0.4, 0.1]}> <sphereGeometry args={[0.2, 12, 12]} /> {leafMaterial} </mesh>
        </group>
        <group position={[-0.15, 0.1, 0]} rotation={[0, 0, -Math.PI / 4]}>
          <mesh scale={[1, 0.4, 0.1]}> <sphereGeometry args={[0.2, 12, 12]} /> {leafMaterial} </mesh>
        </group>
      </group>
    );
  };

  // Lấy thông tin kích thước màn hình 3D (Viewport)
  const { viewport } = useThree();

  // const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70, (Math.random() - 0.5) * 70);
      const h = CONFIG.tree.height; const y = (Math.random() * h * 0.7) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];
      const carouselAngle = (i / count) * Math.PI * 2;

      return {
        chaosPos, targetPos,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        carouselAngle,
        wobbleOffset: Math.random() * 10
      };
    });
  }, [textures, count]);

  const carouselRotation = useRef(0);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const time = stateObj.clock.elapsedTime;

    if (state === 'CAROUSEL' && isSpinning) {
      carouselRotation.current += delta * 0.2;
    } else if (state !== 'CAROUSEL') {
      carouselRotation.current = 0;
    }

    const cameraPos = stateObj.camera.position;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      let targetVector = new THREE.Vector3();
      let targetScale = 1;

      if (state === 'CAROUSEL') {
        // --- LOGIC VÒNG TRÒN ---
        const targetRadiusDest = isSpinning ? 35 : 25;
        const targetHeightDest = isSpinning ? 10 : 5;
        const targetScaleDest = isSpinning ? 14 : 28;

        smoothRadius.current = THREE.MathUtils.lerp(smoothRadius.current, targetRadiusDest, delta * 2.5);
        smoothHeight.current = THREE.MathUtils.lerp(smoothHeight.current, targetHeightDest, delta * 2.5);
        smoothScaleDivisor.current = THREE.MathUtils.lerp(smoothScaleDivisor.current, targetScaleDest, delta * 2.5);

        const currentAngle = objData.carouselAngle + carouselRotation.current;
        const x = Math.sin(currentAngle) * smoothRadius.current;
        const z = Math.cos(currentAngle) * smoothRadius.current;
        targetVector.set(x, smoothHeight.current, z);

        const screenScale = viewport.width / smoothScaleDivisor.current;

        targetScale = screenScale;

        // Luôn hướng về camera
        group.lookAt(cameraPos);

      } else {
        // --- LOGIC CŨ ---
        targetVector = state === 'FORMED' ? objData.targetPos : objData.chaosPos;
        // Scale ngẫu nhiên nhỏ khi ở trên cây
        targetScale = state === 'FORMED' ? (Math.random() < 0.2 ? 1.5 : 1.0) : 1.0;

        if (state === 'FORMED') {
          const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
          group.lookAt(targetLookPos);
          group.rotation.x += Math.sin(time + objData.wobbleOffset) * 0.05;
        }
      }

      // Di chuyển
      objData.currentPos.lerp(targetVector, delta * 2);
      group.position.copy(objData.currentPos);

      // Scale
      const currentScale = group.scale.x;
      const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, delta * 3);
      group.scale.set(nextScale, nextScale, nextScale);
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        const isGold = obj.borderColor === '#D4AF37';

        const borderMaterial = (
          <meshStandardMaterial
            color={obj.borderColor}
            roughness={isGold ? 0.3 : 0.9}
            metalness={isGold ? 1.0 : 0.0}
            envMapIntensity={isGold ? 2.0 : 0.5}
            polygonOffset={true}
            polygonOffsetFactor={1}
          />
        );

        return (
          <group key={i}>
            {/* Nhóm chứa ảnh và viền mặt trước */}
            <group position={[0, 0, 0.06]}>
              {/* Tấm ảnh (Photo) */}
              <mesh geometry={photoGeometry} position={[0, 0, 0.01]}>
                <meshBasicMaterial map={textures[obj.textureIndex]} toneMapped={false} />
              </mesh>

              {/* 👇 KHUNG VIỀN MỚI (RoundedBox) 👇 */}
              {/* args=[rộng, cao, độ dày] */}
              <RoundedBox args={[1.25, 1.65, 0.04]} radius={0.1} smoothness={4} position={[0, -0.15, -0.021]}>
                {borderMaterial}
              </RoundedBox>

              <group position={[0, -1.0, 0.03]}>
                <BellDecoration scale={0.5} />
              </group>
            </group>

            {/* Mặt sau của khung ảnh */}
            <group position={[0, 0, -0.06]} rotation={[0, Math.PI, 0]}>
              <RoundedBox args={[1.25, 1.65, 0.04]} radius={0.1} smoothness={4} position={[0, -0.15, 0]}>
                {borderMaterial}
              </RoundedBox>
            </group>
          </group>
        )
      })}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state }: { state: 'CHAOS' | 'FORMED' | 'CAROUSEL' }) => {
  const count = CONFIG.counts.elements;
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random() - 0.5) * 2.0, y: (Math.random() - 0.5) * 2.0, z: (Math.random() - 0.5) * 2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state !== 'CHAOS';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return (<mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh>)
      })}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state }: { state: 'CHAOS' | 'FORMED' | 'CAROUSEL' }) => {
  const count = CONFIG.counts.lights;
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h / 2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, []);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state !== 'CHAOS';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => (<mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
        <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
      </mesh>))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' | 'CAROUSEL' }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius * Math.cos(angle), radius * Math.sin(angle)) : shape.lineTo(radius * Math.cos(angle), radius * Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4,
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5,
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state !== 'CHAOS' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, isPhotoSpinning }: {
  sceneState: 'CHAOS' | 'FORMED' | 'CAROUSEL',
  rotationSpeed: number,
  isPhotoSpinning: boolean,
}) => {
  const controlsRef = useRef<any>(null);
  useFrame(() => {
    if (controlsRef.current) {
      // controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, 60]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <Environment files="../public/dikhololo_night_4k.exr" background={false} />

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} />
        <Suspense fallback={null}>
          <PhotoOrnaments state={sceneState} isSpinning={isPhotoSpinning} />
          <ChristmasElements state={sceneState} />
          <FairyLights state={sceneState} />
          <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      <EffectComposer>
        <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
        <Vignette eskil={false} offset={0.1} darkness={1.2} />
      </EffectComposer>
    </>
  );
};

// --- Gesture Controller (Phiên bản Bất Tử - Fix lỗi On/Off Loop) ---
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GestureController = ({ onGesture, onMove, onStatus, debugMode }: any) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 1. Dùng Ref để lưu giữ các hàm callback mới nhất
  // Kỹ thuật này giúp useEffect không cần phải chạy lại khi hàm cha thay đổi
  const latestOnGesture = useRef(onGesture);
  const latestOnMove = useRef(onMove);
  const latestOnStatus = useRef(onStatus);

  // Luôn cập nhật Ref mỗi khi component render
  useEffect(() => {
    latestOnGesture.current = onGesture;
    latestOnMove.current = onMove;
    latestOnStatus.current = onStatus;
  }, [onGesture, onMove, onStatus]);

  useEffect(() => {
    let gestureRecognizer: GestureRecognizer | null = null;
    let requestRef: number;
    let isMounted = true;

    // Helper an toàn để gọi status
    const safeStatus = (msg: string) => {
      if (isMounted && latestOnStatus.current) latestOnStatus.current(msg);
    };

    const setup = async () => {
      if (!isMounted) return;
      safeStatus("DOWNLOADING AI...");

      try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
        if (!isMounted) return;

        gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });

        if (!isMounted) { gestureRecognizer.close(); return; }

        safeStatus("REQUESTING CAMERA...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });

          if (!isMounted) {
            stream.getTracks().forEach(t => t.stop());
            gestureRecognizer.close();
            return;
          }

          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play();
            safeStatus("AI READY: SHOW HAND");
            predictWebcam();
          }
        } else {
          safeStatus("ERROR: CAMERA PERMISSION DENIED");
        }
      } catch (err: any) {
        safeStatus(`ERROR: ${err.message || 'MODEL FAILED'}`);
      }
    };

    const predictWebcam = () => {
      if (!isMounted) return;

      if (gestureRecognizer && videoRef.current && canvasRef.current) {
        if (videoRef.current.videoWidth > 0) {
          try {
            const results = gestureRecognizer.recognizeForVideo(videoRef.current, Date.now());
            const ctx = canvasRef.current.getContext("2d");

            // Vẽ Debug
            if (ctx && debugMode) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
              canvasRef.current.width = videoRef.current.videoWidth;
              canvasRef.current.height = videoRef.current.videoHeight;
              if (results.landmarks) for (const landmarks of results.landmarks) {
                const drawingUtils = new DrawingUtils(ctx);
                drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: "#FFD700", lineWidth: 2 });
                drawingUtils.drawLandmarks(landmarks, { color: "#FF0000", lineWidth: 1 });
              }
            } else if (ctx && !debugMode) {
              ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            }

            if (results.gestures.length > 0) {
              const name = results.gestures[0][0].categoryName;
              const score = results.gestures[0][0].score;

              if (score > 0.4) {
                if (latestOnStatus.current) latestOnStatus.current(`DETECTED: ${name} (${(score * 100).toFixed(0)}%)`);

                if (["Open_Palm", "Closed_Fist", "Pointing_Up", "Victory", "ILoveYou"].includes(name)) {
                  if (latestOnGesture.current) latestOnGesture.current(name);
                }
              }

              if (results.landmarks.length > 0) {
                const speed = (0.5 - results.landmarks[0][0].x) * 0.15;
                const finalSpeed = Math.abs(speed) > 0.01 ? speed : 0;
                if (latestOnMove.current) latestOnMove.current(finalSpeed);
              }
            } else {
              if (latestOnMove.current) latestOnMove.current(0);
              if (debugMode && latestOnStatus.current) latestOnStatus.current("AI READY: NO HAND");
            }
          } catch (e) { console.warn(e); }
        }
        requestRef = requestAnimationFrame(predictWebcam);
      }
    };

    setup();

    return () => {
      isMounted = false;
      if (requestRef) cancelAnimationFrame(requestRef);
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      if (gestureRecognizer) gestureRecognizer.close();
    };

  }, [debugMode]);

  return (
    <>
      <video ref={videoRef} style={{ opacity: debugMode ? 0.6 : 0, position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', zIndex: debugMode ? 100 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} playsInline muted autoPlay />
      <canvas ref={canvasRef} style={{ position: 'fixed', top: 0, right: 0, width: debugMode ? '320px' : '1px', height: debugMode ? 'auto' : '1px', zIndex: debugMode ? 101 : -1, pointerEvents: 'none', transform: 'scaleX(-1)' }} />
    </>
  );
};

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED' | 'CAROUSEL'>('CHAOS');
  const [rotationSpeed, setRotationSpeed] = useState(0);
  const [aiStatus, setAiStatus] = useState("INITIALIZING...");
  const [debugMode, setDebugMode] = useState(false);

  const [isPhotoSpinning, setIsPhotoSpinning] = useState(false);

  const handleGesture = (gestureName: string) => {
    if (gestureName === 'Open_Palm') {
      setSceneState('CHAOS');
      setIsPhotoSpinning(false);
    } else if (gestureName === 'Closed_Fist') {
      setSceneState('FORMED');
      setIsPhotoSpinning(false);
    } else if (gestureName === 'Pointing_Up') {
      setSceneState('CAROUSEL');
      setIsPhotoSpinning(false);
    } else if (gestureName === 'Victory') {
      setSceneState('CAROUSEL');
      setIsPhotoSpinning(true);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={[1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping }} shadows>
          <Experience
            sceneState={sceneState}
            rotationSpeed={rotationSpeed}
            isPhotoSpinning={isPhotoSpinning}
          />
        </Canvas>
      </div>
      <GestureController
        onGesture={(g: string) => handleGesture(g)}
        onMove={setRotationSpeed}
        onStatus={setAiStatus}
        debugMode={debugMode}
      />

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Memories</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {CONFIG.counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>POLAROIDS</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>Foliage</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(CONFIG.counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>EMERALD NEEDLES</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        <button onClick={() => setDebugMode(!debugMode)} style={{ padding: '12px 15px', backgroundColor: debugMode ? '#FFD700' : 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: debugMode ? '#000' : '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          {debugMode ? 'HIDE DEBUG' : '🛠 DEBUG'}
        </button>
        <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          {sceneState === 'CHAOS' ? 'Assemble Tree' : 'Disperse'}
        </button>
      </div>

      {/* UI - AI Status */}
      <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', color: aiStatus.includes('ERROR') ? '#FF0000' : 'rgba(255, 215, 0, 0.4)', fontSize: '10px', letterSpacing: '2px', zIndex: 10, background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: '4px' }}>
        {aiStatus}
      </div>
    </div>
  );
}