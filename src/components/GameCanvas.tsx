/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { socket } from '../services/socket';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Environment, Text, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { Player } from '../types';

const TRACK_WIDTH = 1200;
const TRACK_HEIGHT = 850;

// Car physics constants
const ACCELERATION = 0.06;
const MAX_SPEED = 2.4;
const NITRO_SPEED = 4.125;
const NITRO_ACCEL = 0.12;
const FRICTION = 0.97;
const TURN_SPEED = 0.035;
const DRIFT_FACTOR = 0.94;

// Track Geometry
const TRACK_RADIUS = 50; // Slightly narrower for more technical turns
const TRACK_SEGMENTS = [
    { start: {x: 150, y: 500}, end: {x: 450, y: 500}, angle: 0 },
    { start: {x: 450, y: 500}, end: {x: 450, y: 300}, angle: -Math.PI/2 },
    { start: {x: 450, y: 300}, end: {x: 300, y: 300}, angle: Math.PI },
    { start: {x: 300, y: 300}, end: {x: 300, y: 100}, angle: -Math.PI/2 },
    { start: {x: 300, y: 100}, end: {x: 750, y: 100}, angle: 0 },
    { start: {x: 750, y: 100}, end: {x: 750, y: 400}, angle: Math.PI/2 },
    { start: {x: 750, y: 400}, end: {x: 600, y: 400}, angle: Math.PI },
    { start: {x: 600, y: 400}, end: {x: 600, y: 600}, angle: Math.PI/2 },
    { start: {x: 600, y: 600}, end: {x: 950, y: 600}, angle: 0 },
    { start: {x: 950, y: 600}, end: {x: 950, y: 150}, angle: -Math.PI/2 },
    { start: {x: 950, y: 150}, end: {x: 1100, y: 150}, angle: 0 },
    { start: {x: 1100, y: 150}, end: {x: 1100, y: 750}, angle: Math.PI/2 },
    { start: {x: 1100, y: 750}, end: {x: 150, y: 750}, angle: Math.PI },
    { start: {x: 150, y: 750}, end: {x: 150, y: 500}, angle: -Math.PI/2 }
];

// Math helpers for collision
function getClosestPointOnSegment(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
  if (l2 === 0) return v;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
}

function distToSegmentSquared(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
  if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x)))**2 + (p.y - (v.y + t * (w.y - v.y)))**2;
}

function distToSegment(p: {x: number, y: number}, v: {x: number, y: number}, w: {x: number, y: number}) {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

const isPointOnTrackMath = (x: number, y: number, buffer: number = 0): boolean => {
  const p = {x, y};
  let minDist = Infinity;
  
  for (const seg of TRACK_SEGMENTS) {
    const d = distToSegment(p, seg.start, seg.end);
    if (d < minDist) minDist = d;
  }

  return minDist <= (TRACK_RADIUS + buffer);
};

// 3D Components
const CarModel = ({ color, isLocal, drifting }: { color: string, isLocal?: boolean, drifting?: boolean }) => {
  return (
    <group scale={[2, 2, 2]}>
      {/* Body */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[2, 1, 4]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 1.2, -0.5]} castShadow>
        <boxGeometry args={[1.8, 0.8, 2]} />
        <meshStandardMaterial color="#333" />
      </mesh>
      {/* Wheels */}
      <mesh position={[1.1, 0.4, 1.2]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.4, 16]} />
        <meshStandardMaterial color="black" />
      </mesh>
      <mesh position={[-1.1, 0.4, 1.2]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.4, 16]} />
        <meshStandardMaterial color="black" />
      </mesh>
      <mesh position={[1.1, 0.4, -1.2]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.4, 16]} />
        <meshStandardMaterial color="black" />
      </mesh>
      <mesh position={[-1.1, 0.4, -1.2]} rotation={[0, 0, Math.PI/2]}>
        <cylinderGeometry args={[0.4, 0.4, 0.4, 16]} />
        <meshStandardMaterial color="black" />
      </mesh>
      {/* Headlights */}
      <mesh position={[0.6, 0.6, 2.05]}>
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshStandardMaterial color="yellow" emissive="yellow" emissiveIntensity={2} />
      </mesh>
      <mesh position={[-0.6, 0.6, 2.05]}>
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshStandardMaterial color="yellow" emissive="yellow" emissiveIntensity={2} />
      </mesh>
      {/* Taillights */}
      <mesh position={[0.6, 0.6, -2.05]}>
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshStandardMaterial color="red" emissive="red" emissiveIntensity={1} />
      </mesh>
      <mesh position={[-0.6, 0.6, -2.05]}>
        <boxGeometry args={[0.5, 0.2, 0.1]} />
        <meshStandardMaterial color="red" emissive="red" emissiveIntensity={1} />
      </mesh>
      
      {/* Drift Smoke Particles (Simple visual representation attached to car) */}
      {drifting && (
        <>
          <mesh position={[1.2, 0.2, -1.5]}>
             <sphereGeometry args={[0.3, 8, 8]} />
             <meshBasicMaterial color="#aaa" transparent opacity={0.6} />
          </mesh>
          <mesh position={[-1.2, 0.2, -1.5]}>
             <sphereGeometry args={[0.3, 8, 8]} />
             <meshBasicMaterial color="#aaa" transparent opacity={0.6} />
          </mesh>
        </>
      )}

      {isLocal && (
        <pointLight position={[0, 2, 4]} intensity={10} distance={20} color="white" />
      )}
    </group>
  );
};

const Tree = ({ position, scale = 1 }: { position: [number, number, number], scale?: number }) => {
  return (
    <group position={position} scale={scale}>
      {/* Trunk */}
      <mesh position={[0, 3, 0]} castShadow>
        <cylinderGeometry args={[0.6, 0.8, 6, 8]} />
        <meshStandardMaterial color="#4d2926" />
      </mesh>
      {/* Leaves */}
      <mesh position={[0, 9, 0]} castShadow>
        <coneGeometry args={[4, 10, 8]} />
        <meshStandardMaterial color="#2d5a27" />
      </mesh>
      <mesh position={[0, 13, 0]} castShadow>
        <coneGeometry args={[3, 7, 8]} />
        <meshStandardMaterial color="#3a7532" />
      </mesh>
    </group>
  );
};

const Rock = ({ position, scale = 1 }: { position: [number, number, number], scale?: number }) => {
  return (
    <mesh position={position} scale={scale} castShadow receiveShadow>
      <dodecahedronGeometry args={[1.5, 0]} />
      <meshStandardMaterial color="#666" roughness={0.9} />
    </mesh>
  );
};

const TrackMesh = () => {
  const segments = useMemo(() => {
    return TRACK_SEGMENTS.map((seg, i) => {
      const dx = seg.end.x - seg.start.x;
      const dy = seg.end.y - seg.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const centerX = (seg.start.x + seg.end.x) / 2;
      const centerY = (seg.start.y + seg.end.y) / 2;
      return { length, angle, centerX, centerY, id: i };
    });
  }, []);

  const corners = useMemo(() => {
    return TRACK_SEGMENTS.map((seg) => seg.start);
  }, []);

  return (
    <group rotation={[-Math.PI / 2, 0, 0]} scale={[1, -1, 1]}>
      {/* Grass/Off-track */}
      <mesh position={[TRACK_WIDTH/2, TRACK_HEIGHT/2, -0.1]} receiveShadow>
        <planeGeometry args={[3000, 3000]} />
        <meshStandardMaterial color="#1a472a" roughness={1} />
      </mesh>
      
      {/* Track Segments */}
      {segments.map((seg) => (
        <mesh key={seg.id} position={[seg.centerX, seg.centerY, 0.1]} rotation={[0, 0, seg.angle]} receiveShadow>
          <planeGeometry args={[seg.length, TRACK_RADIUS * 2]} />
          <meshStandardMaterial color="#333" roughness={0.8} />
        </mesh>
      ))}

      {/* Smooth Corners */}
      {corners.map((pos, i) => (
        <mesh key={i} position={[pos.x, pos.y, 0.1]} receiveShadow>
          <circleGeometry args={[TRACK_RADIUS, 32]} />
          <meshStandardMaterial color="#333" roughness={0.8} />
        </mesh>
      ))}
      
      {/* Start Line */}
      <mesh position={[625, 750, 0.11]} rotation={[0, 0, 0]}>
        <planeGeometry args={[10, TRACK_RADIUS * 2]} />
        <meshStandardMaterial color="white" />
      </mesh>
    </group>
  );
};

const GameScene = ({ 
  localPlayerRef, 
  players, 
  myId 
}: { 
  localPlayerRef: React.MutableRefObject<any>, 
  players: Record<string, Player>, 
  myId: string | null 
}) => {
  const { camera } = useThree();
  const carRef = useRef<THREE.Group>(null);

  const decorations = useMemo(() => {
    const items: { type: 'tree' | 'rock', pos: [number, number, number], scale: number }[] = [];
    const count = 350; // Increased for better density
    const seed = 42;
    const rng = (s: number) => {
        const x = Math.sin(s) * 10000;
        return x - Math.floor(x);
    };
    let s = seed;

    for (let i = 0; i < count; i++) {
      // Area large enough to fill the new draw distance
      const x = rng(s++) * 2400 - 800; 
      const z = rng(s++) * 2200 - 800;
      
      // Check if on track using the math helper with a buffer to account for decoration size
      if (!isPointOnTrackMath(x, z, 20)) {
        const type = rng(s++) > 0.4 ? 'tree' : 'rock';
        const scale = type === 'tree' ? 2.5 + rng(s++) * 3.5 : 3 + rng(s++) * 5;
        items.push({ type, pos: [x, 0, z], scale });
      }
    }
    return items;
  }, []);
  
  useFrame((state, delta) => {
    if (localPlayerRef.current && carRef.current) {
      const p = localPlayerRef.current;
      
      // Map 2D (x, y) to 3D (x, 0, z)
      carRef.current.position.set(p.x, 0, p.y);
      
      // Rotation: 2D angle 0 is Right (+X). 3D Box faces +Z.
      // We need to rotate Y.
      // If angle=0, we want car to face +X.
      // Box faces +Z. Rotate Y by +PI/2 faces +X.
      // 2D angle increases clockwise (screen Y down).
      // 3D Y-rotation increases counter-clockwise.
      // So rotation = -angle + PI/2.
      carRef.current.rotation.y = -p.angle + Math.PI/2; 

      // Camera Follow
      const dist = 40;
      const height = 20;
      const angle = p.angle;
      
      // Camera behind car
      // 2D velocity vector is (cos(angle), sin(angle))
      // Camera should be at p - velocity * dist
      const targetCamX = p.x - Math.cos(angle) * dist;
      const targetCamZ = p.y - Math.sin(angle) * dist;
      
      // Smooth camera
      camera.position.lerp(new THREE.Vector3(targetCamX, height, targetCamZ), 0.1);
      camera.lookAt(p.x, 0, p.y);
    }
  });

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight 
        position={[600, 300, 425]} 
        intensity={1} 
        castShadow 
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-700}
        shadow-camera-right={700}
        shadow-camera-top={700}
        shadow-camera-bottom={-700}
        shadow-camera-far={1000}
      />
      <Environment preset="sunset" />
      
      <TrackMesh />
      
      {/* Decorative Elements */}
      {decorations.map((item, i) => (
        item.type === 'tree' ? (
          <Tree key={i} position={item.pos} scale={item.scale} />
        ) : (
          <Rock key={i} position={item.pos} scale={item.scale} />
        )
      ))}
      
      {/* Local Player */}
      <group ref={carRef}>
        <CarModel color={players[myId || '']?.color || 'red'} isLocal drifting={localPlayerRef.current?.drifting} />
      </group>
      
      {/* Remote Players */}
      {Object.values(players).map(p => {
        if (p.id === myId) return null;
        return (
          <group key={p.id} position={[p.x, 0, p.y]} rotation={[0, -p.angle + Math.PI/2, 0]}>
            <CarModel color={p.color} drifting={p.drifting} />
            <Text position={[0, 3, 0]} fontSize={2} color="white" anchorX="center" anchorY="middle">
              {p.name}
            </Text>
          </group>
        );
      })}
    </>
  );
};

export default function GameCanvas({ initialPlayers }: { initialPlayers?: Record<string, Player> }) {
  // Sanitize initial players to handle Infinity/null issue
  const sanitizedInitial = useMemo(() => {
      if (!initialPlayers) return {};
      return Object.entries(initialPlayers).reduce((acc, [id, p]) => {
        acc[id] = { ...p, bestLapTime: p.bestLapTime || Infinity };
        return acc;
      }, {} as Record<string, Player>);
  }, [initialPlayers]);

  const [players, setPlayers] = useState<Record<string, Player>>(sanitizedInitial);
  const [myId, setMyId] = useState<string | null>(socket.id || null);
  const [laps, setLaps] = useState(0);
  const [lastLapTime, setLastLapTime] = useState<number | null>(null);
  const [currentLapStart, setCurrentLapStart] = useState<number>(Date.now());
  const [nitro, setNitro] = useState(100);
  const [wrongWay, setWrongWay] = useState(false);
  const timerRef = useRef<HTMLDivElement>(null);
  
  // HUD Helper
  const formatTime = (ms: number) => {
      if (ms === Infinity || !ms) return "--:--";
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const rs = s % 60;
      const msPart = Math.floor((ms % 1000) / 10);
      return `${m}:${rs.toString().padStart(2, '0')}.${msPart.toString().padStart(2, '0')}`;
  };
  
  // Local state for smooth physics
  const localPlayer = useRef<{
    x: number;
    y: number;
    angle: number;
    speed: number;
    keys: Record<string, boolean>;
    checkpoint: number; // 0: Start, 1: Top, 2: Bottom
    nitro: number;
    drifting: boolean;
    wrongWayTimer: number | null;
    lapCount: number;
  }>({
    x: 650,
    y: 750,
    angle: Math.PI,
    speed: 0,
    keys: {},
    checkpoint: 3, // Start in sector 3 (before finish line)
    nitro: 100,
    drifting: false,
    wrongWayTimer: null,
    lapCount: 0,
  });

  // Initialize local player position from props if available
  useEffect(() => {
      if (myId && players[myId]) {
          const p = players[myId];
          localPlayer.current.x = p.x;
          localPlayer.current.y = p.y;
          localPlayer.current.angle = p.angle;
          // Don't reset laps here as game might be in progress? 
          // Actually for new game start, laps are 0.
      }
  }, [myId]); // Run once when ID is confirmed

  // Particle System
  const [particles, setParticles] = useState<{id: number, x: number, y: number, life: number}[]>([]);
  const particleIdCounter = useRef(0);

  useEffect(() => {
    // Socket event listeners
    socket.on('connect', () => {
      setMyId(socket.id || null);
    });

    // 'currentPlayers' and 'newPlayer' are handled in Lobby now.
    // We only need game-specific updates here.
    
    socket.on('playerJoinedRoom', (player: unknown) => {
      const p = player as Player;
      setPlayers((prev) => ({ ...prev, [p.id]: { ...p, bestLapTime: p.bestLapTime || Infinity } }));
    });

    socket.on('playerMoved', (player: unknown) => {
      const p = player as Player;
      setPlayers((prev) => {
        // Don't update local player from server to avoid jitter
        if (p.id === socket.id) return prev;
        return { ...prev, [p.id]: { ...p, bestLapTime: p.bestLapTime || Infinity } };
      });
    });
    
    socket.on('lapUpdate', (data: {id: string, laps: number, bestLapTime: number}) => {
        setPlayers(prev => {
            if (!prev[data.id]) return prev;
            
            // If server sends null/0 (from Infinity), treat as Infinity
            const serverBest = data.bestLapTime || Infinity;
            
            // If this is local player, only update if server time is BETTER or EQUAL to local time
            // This prevents overwriting optimistic update with stale server data
            if (data.id === socket.id) {
                 const currentBest = prev[data.id].bestLapTime || Infinity;
                 if (serverBest > currentBest && currentBest !== Infinity) {
                     // Server sent worse time than we have locally? Ignore it.
                     return prev;
                 }
            }

            return {
                ...prev,
                [data.id]: {
                    ...prev[data.id],
                    laps: data.laps,
                    bestLapTime: serverBest
                }
            };
        });
    });

    socket.on('playerDisconnected', (id: string) => {
      setPlayers((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    });

    return () => {
      socket.off('connect');
      socket.off('playerJoinedRoom');
      socket.off('playerMoved');
      socket.off('playerDisconnected');
      socket.off('lapUpdate');
    };
  }, []);

  // Input handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      localPlayer.current.keys[e.code] = true;
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      localPlayer.current.keys[e.code] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Physics Loop (runs independently of 3D render loop)
  useEffect(() => {
    let animationFrameId: number;

    const updatePhysics = () => {
      const p = localPlayer.current;
      const oldX = p.x;
      const oldY = p.y;
      
      // Acceleration
      if (p.keys['ArrowUp'] || p.keys['KeyW']) {
        p.speed += ACCELERATION;
      } else if (p.keys['ArrowDown'] || p.keys['KeyS']) {
        p.speed -= ACCELERATION;
      } else {
        p.speed *= FRICTION;
      }

      // Nitro
      if ((p.keys['ShiftLeft'] || p.keys['ShiftRight']) && p.nitro > 0) {
          p.speed += NITRO_ACCEL;
          p.nitro = Math.max(0, p.nitro - 1);
      } else {
          p.nitro = Math.min(100, p.nitro + 0.2);
      }
      setNitro(p.nitro);

      // Drifting Logic
      // Drift if turning + Spacebar OR turning sharply at high speed
      const isTurning = p.keys['ArrowLeft'] || p.keys['KeyA'] || p.keys['ArrowRight'] || p.keys['KeyD'];
      const wantsDrift = p.keys['Space'];
      
      if (wantsDrift && isTurning && Math.abs(p.speed) > 1.5) {
          p.drifting = true;
      } else {
          p.drifting = false;
      }

      // Max Speed Cap
      const isNitroActive = (p.keys['ShiftLeft'] || p.keys['ShiftRight']) && p.nitro > 0;
      const currentMaxSpeed = isNitroActive ? NITRO_SPEED : MAX_SPEED;
      
      if (p.speed > currentMaxSpeed) {
          if (isNitroActive) {
              p.speed = currentMaxSpeed;
          } else {
              // If nitro just ran out or was released, gradually slow down to max speed
              p.speed = Math.max(currentMaxSpeed, p.speed * 0.98);
          }
      }
      if (p.speed < -MAX_SPEED / 2) p.speed = -MAX_SPEED / 2;

      // Turning
      if (Math.abs(p.speed) > 0.1) {
        let turn = TURN_SPEED * (p.speed / MAX_SPEED);
        
        // Enhance turning while drifting
        if (p.drifting) {
            turn *= 1.5; // Sharper turn
            p.speed *= 0.98; // Slight drag while drifting
            
            // Generate particles
            if (Math.random() > 0.5) {
                setParticles(prev => [
                    ...prev, 
                    {
                        id: particleIdCounter.current++, 
                        x: p.x + (Math.random() - 0.5) * 2, 
                        y: p.y + (Math.random() - 0.5) * 2, 
                        life: 1.0
                    }
                ]);
            }
        }

        if (p.keys['ArrowLeft'] || p.keys['KeyA']) {
          p.angle -= turn;
        }
        if (p.keys['ArrowRight'] || p.keys['KeyD']) {
          p.angle += turn;
        }
      }

      // Movement
      // If drifting, momentum carries slightly sideways? 
      // For simplicity in this 2D-to-3D mapping, we just update position based on angle.
      // A true drift would vector add velocity + slip. 
      // Here we just let the "sharper turn" simulate the oversteer feel visually.
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed;

      // Update Particles
      setParticles(prev => prev.map(pt => ({...pt, life: pt.life - 0.05})).filter(pt => pt.life > 0));

      // Find closest segment for target angle and collision
      let closestPt = {x: p.x, y: p.y};
      let minD2 = Infinity;
      let targetAngle = 0;
      
      TRACK_SEGMENTS.forEach(seg => {
          const pt = getClosestPointOnSegment({x: p.x, y: p.y}, seg.start, seg.end);
          const d2 = (pt.x - p.x)**2 + (pt.y - p.y)**2;
          if (d2 < minD2) {
              minD2 = d2;
              closestPt = pt;
              targetAngle = seg.angle;
          }
      });

      // Track Collision (Off-track logic)
      if (Math.sqrt(minD2) > TRACK_RADIUS) {
        // Off-track: Apply heavy friction/slowdown instead of hard wall
        p.speed *= 0.9; // Rapidly slow down
        
        // Cap max speed on grass
        if (p.speed > 1.2) p.speed = 1.2;
        if (p.speed < -0.75) p.speed = -0.75;

        p.drifting = false; // Harder to drift on grass
        
        // Optional: Add some wobble or vibration effect here if desired
      }

      // Sector/Lap Logic
      // Check distance to specific segments to act as checkpoints
      let currentSector = -1;
      const d0 = distToSegment({x: p.x, y: p.y}, TRACK_SEGMENTS[0].start, TRACK_SEGMENTS[0].end);
      const d1 = distToSegment({x: p.x, y: p.y}, TRACK_SEGMENTS[4].start, TRACK_SEGMENTS[4].end);
      const d2 = distToSegment({x: p.x, y: p.y}, TRACK_SEGMENTS[8].start, TRACK_SEGMENTS[8].end);
      const d3 = distToSegment({x: p.x, y: p.y}, TRACK_SEGMENTS[11].start, TRACK_SEGMENTS[11].end);

      if (d0 < TRACK_RADIUS * 1.5) currentSector = 0;
      else if (d1 < TRACK_RADIUS * 1.5) currentSector = 1;
      else if (d2 < TRACK_RADIUS * 1.5) currentSector = 2;
      else if (d3 < TRACK_RADIUS * 1.5) currentSector = 3;
      
      // Checkpoint progression
      if (currentSector !== -1) {
          const nextCheckpoint = (p.checkpoint + 1) % 4;
          if (currentSector === nextCheckpoint) {
              p.checkpoint = currentSector;
          }
      }

      // Lap Finish Check (Crossing x=625 on segment 12)
      const onFinishStraight = p.y > 700 && p.y < 800;
      if (p.checkpoint === 3 && onFinishStraight && oldX >= 625 && p.x < 625) {
          const now = Date.now();
          const lapTime = now - currentLapStart;
          
          // Always reset timer for the next lap
          setCurrentLapStart(now);
          
          // Increment internal lap count
          p.lapCount = (p.lapCount || 0) + 1;
          setLaps(p.lapCount);
          
          // Only record best time if this wasn't the start-line crossing (Lap 1 start)
          if (p.lapCount > 1) {
              setLastLapTime(lapTime);
              
              // Optimistically update local player's best lap time
              setPlayers(prev => {
                  if (!myId || !prev[myId]) return prev;
                  const currentBest = prev[myId].bestLapTime;
                  if (!currentBest || lapTime < currentBest) {
                      return {
                          ...prev,
                          [myId]: {
                              ...prev[myId],
                              bestLapTime: lapTime
                          }
                      };
                  }
                  return prev;
              });

              // Send to server
              socket.emit('lapFinished', lapTime);
          }
          
          // Reset checkpoint for next lap
          p.checkpoint = -1; // Wait for sector 0
      }

      // Wrong Way Detection (Angle based)
      // Use targetAngle from the closest segment (calculated above in collision logic)
      
      // Normalize player angle to -PI to PI
      let pAngle = p.angle % (Math.PI * 2);
      if (pAngle > Math.PI) pAngle -= Math.PI * 2;
      if (pAngle < -Math.PI) pAngle += Math.PI * 2;
      
      // Calculate difference
      let diff = Math.abs(pAngle - targetAngle);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      
      // If angle difference is > 115 degrees (approx 2.0 rad), show warning
      // Only if moving forward (speed > 0.5)
      // Removed isOnTrack check to ensure it triggers even if slightly off-line
      const isWrongWayConditionMet = diff > 2.0 && p.speed > 0.5;
      
      if (isWrongWayConditionMet) {
          if (p.wrongWayTimer === null) {
              p.wrongWayTimer = Date.now();
          } else if (Date.now() - p.wrongWayTimer > 100) {
              setWrongWay(true);
          }
      } else {
          // Reset timer if we are facing correct way OR moving slow
          p.wrongWayTimer = null;
          setWrongWay(false);
      }


      // Send update
      if (socket.connected) {
        socket.emit('playerMovement', {
          x: p.x,
          y: p.y,
          angle: p.angle,
          speed: p.speed,
          nitro: p.nitro,
          drifting: p.drifting
        });
      }

      // Update Timer DOM
      if (timerRef.current) {
          timerRef.current.innerText = formatTime(Date.now() - currentLapStart);
      }

      animationFrameId = requestAnimationFrame(updatePhysics);
    };

    updatePhysics();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [currentLapStart]);

  return (
    <div className="relative w-full h-[850px] bg-slate-900 rounded-xl overflow-hidden shadow-2xl border-4 border-slate-700">
      <Canvas shadows>
        <color attach="background" args={['#0f172a']} />
        <PerspectiveCamera makeDefault position={[0, 50, 50]} fov={60} far={1000} />
        <fog attach="fog" args={['#0f172a', 100, 900]} />
        <GameScene localPlayerRef={localPlayer} players={players} myId={myId} />
        
        {/* Particles */}
        {particles.map(pt => (
            <mesh key={pt.id} position={[pt.x, 2, pt.y]} rotation={[-Math.PI/2, 0, 0]}>
                <planeGeometry args={[1.5 * pt.life, 1.5 * pt.life]} />
                <meshBasicMaterial color="#888" transparent opacity={0.4 * pt.life} />
            </mesh>
        ))}

        <OrbitControls enabled={false} />
      </Canvas>
      
      {/* HUD Overlay */}
      {/* Top Left: Leaderboard */}
      <div className="absolute top-6 left-6 flex flex-col gap-3 pointer-events-none">
          <div className="bg-black/50 text-white p-5 rounded-xl border border-white/10 backdrop-blur-md w-56">
              <div className="text-xs text-slate-400 uppercase tracking-wider mb-2 font-bold">Leaderboard</div>
              <div className="space-y-2">
                  {Object.values(players)
                    .map(p => p as Player)
                    .sort((a, b) => (a.bestLapTime || Infinity) - (b.bestLapTime || Infinity))
                    .slice(0, 5)
                    .map((p, i) => (
                      <div key={p.id} className="flex justify-between text-sm">
                          <span className={`${p.id === socket.id ? 'text-yellow-400 font-bold' : 'text-slate-300'} truncate max-w-[120px]`}>
                              {i+1}. {p.name}
                          </span>
                          <span className="font-mono text-slate-400">
                              {p.bestLapTime !== Infinity ? formatTime(p.bestLapTime) : '-'}
                          </span>
                      </div>
                  ))}
              </div>
          </div>
      </div>

      {/* Top Center: Lap Timer */}
      <div className="absolute top-6 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/50 text-white px-8 py-4 rounded-full border border-white/10 backdrop-blur-md flex items-center gap-8">
              <div className="text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Current</div>
                  <div ref={timerRef} className="text-3xl font-mono font-bold text-yellow-400 leading-none">
                      {formatTime(Date.now() - currentLapStart)}
                  </div>
              </div>
              <div className="w-px h-12 bg-white/20"></div>
              <div className="text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Best</div>
                  <div className="text-2xl font-mono text-slate-300 leading-none">
                      {players[socket.id || '']?.bestLapTime !== Infinity ? formatTime(players[socket.id || '']?.bestLapTime || 0) : '--:--'}
                  </div>
              </div>
              <div className="w-px h-12 bg-white/20"></div>
               <div className="text-center">
                  <div className="text-xs text-slate-400 uppercase tracking-wider font-bold">Lap</div>
                  <div className="text-2xl font-mono text-slate-300 leading-none">
                      {laps}
                  </div>
              </div>
          </div>
      </div>

      {/* Bottom Center: Nitro Bar */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 pointer-events-none w-80">
          <div className="flex justify-between text-xs text-slate-400 uppercase tracking-wider font-bold mb-2">
              <span>Nitro</span>
              <span>{Math.round(nitro)}%</span>
          </div>
          <div className="w-full h-4 bg-slate-800/50 rounded-full overflow-hidden border border-white/20 backdrop-blur-md">
              <div 
                className="h-full bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-300 shadow-[0_0_15px_rgba(59,130,246,0.6)]"
                style={{ width: `${nitro}%` }}
              />
          </div>
      </div>

      {/* Wrong Way Warning */}
      {wrongWay && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="bg-red-600/90 text-white px-12 py-8 rounded-2xl border-8 border-white shadow-2xl animate-pulse">
                <div className="text-6xl font-black italic uppercase tracking-widest">WRONG WAY</div>
            </div>
        </div>
      )}

      {/* Bottom Left: Controls (Faded) */}
      <div className="absolute bottom-6 left-6 text-white pointer-events-none opacity-50 hover:opacity-100 transition-opacity duration-300">
        <div className="bg-black/40 p-5 rounded-xl backdrop-blur-md border border-white/10">
            <h3 className="font-bold text-sm mb-2 text-yellow-400/80">Controls</h3>
            <ul className="text-xs space-y-1 font-mono text-slate-300">
            <li>W / UP : Accelerate</li>
            <li>S / DOWN : Brake</li>
            <li>A / D  : Turn</li>
            <li>SPACE  : Drift</li>
            <li>SHIFT  : Nitro</li>
            </ul>
        </div>
      </div>
    </div>
  );
}
