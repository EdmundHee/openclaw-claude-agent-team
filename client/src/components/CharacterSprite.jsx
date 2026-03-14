import { useRef, useEffect, useState } from 'react';

/**
 * Character Sprite Component
 *
 * Renders a pixel-art character on a canvas with two states:
 *   - IDLE: gentle breathing/bobbing animation
 *   - WORKING: typing animation with active motion
 *
 * Sprite system is designed to be swappable:
 *   - Place sprite sheets in /public/sprites/
 *   - Each character needs: idle frames + working frames
 *   - Or use the built-in procedural characters (default)
 *
 * Sprite sheet format (if using image):
 *   Row 0: idle frames (2+ frames, 32x32 each)
 *   Row 1: working frames (2+ frames, 32x32 each)
 */

// --- Built-in procedural character palettes ---
const PALETTES = [
  { body: '#6C5CE7', accent: '#A29BFE', eye: '#2D3436' }, // Purple
  { body: '#00B894', accent: '#55EFC4', eye: '#2D3436' }, // Green
  { body: '#E17055', accent: '#FAB1A0', eye: '#2D3436' }, // Coral
  { body: '#0984E3', accent: '#74B9FF', eye: '#2D3436' }, // Blue
  { body: '#FDCB6E', accent: '#FFEAA7', eye: '#2D3436' }, // Yellow
  { body: '#E84393', accent: '#FD79A8', eye: '#2D3436' }, // Pink
  { body: '#00CEC9', accent: '#81ECEC', eye: '#2D3436' }, // Teal
  { body: '#FF7675', accent: '#FFB8B8', eye: '#2D3436' }, // Red
  { body: '#A29BFE', accent: '#DFE6E9', eye: '#2D3436' }, // Lavender
  { body: '#636E72', accent: '#B2BEC3', eye: '#DFE6E9' }, // Gray
];

// OpenClaw special palette
const OPENCLAW_PALETTE = {
  body: '#FF6B35',
  accent: '#FFB347',
  eye: '#2D3436',
  crown: '#FFD700'
};

const FRAME_SIZE = 32;
const ANIMATION_FPS = 4;

function drawProceduralCharacter(ctx, palette, frame, state, isOpenClaw, size) {
  const scale = size / FRAME_SIZE;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.imageSmoothingEnabled = false;

  // Clear
  ctx.clearRect(0, 0, FRAME_SIZE, FRAME_SIZE);

  const bobY = state === 'idle'
    ? Math.sin(frame * 0.8) * 1.5
    : (frame % 2 === 0 ? -1 : 1);

  const baseY = 6 + bobY;

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath();
  ctx.ellipse(16, 28, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = palette.body;
  roundRect(ctx, 8, baseY + 8, 16, 14, 4);
  ctx.fill();

  // Head
  ctx.fillStyle = palette.body;
  roundRect(ctx, 9, baseY - 1, 14, 12, 5);
  ctx.fill();

  // Face highlight
  ctx.fillStyle = palette.accent;
  roundRect(ctx, 11, baseY + 1, 10, 6, 3);
  ctx.fill();

  // Eyes
  ctx.fillStyle = palette.eye;
  const blinkFrame = frame % 20 === 0;
  if (blinkFrame) {
    // Blink
    ctx.fillRect(12, baseY + 4, 3, 1);
    ctx.fillRect(17, baseY + 4, 3, 1);
  } else {
    // Open eyes
    ctx.fillRect(12, baseY + 3, 3, 2);
    ctx.fillRect(17, baseY + 3, 3, 2);

    // Eye shine
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(13, baseY + 3, 1, 1);
    ctx.fillRect(18, baseY + 3, 1, 1);
  }

  // Mouth
  if (state === 'working' && frame % 2 === 0) {
    ctx.fillStyle = palette.eye;
    ctx.fillRect(14, baseY + 7, 4, 2);
    ctx.fillStyle = '#FF6B6B';
    ctx.fillRect(15, baseY + 7, 2, 1);
  } else {
    ctx.fillStyle = palette.eye;
    ctx.fillRect(14, baseY + 7, 4, 1);
  }

  // Arms
  ctx.fillStyle = palette.body;
  if (state === 'working') {
    // Typing arms
    const armUp = frame % 2 === 0;
    ctx.fillRect(5, baseY + 10 + (armUp ? -1 : 1), 3, 5);
    ctx.fillRect(24, baseY + 10 + (armUp ? 1 : -1), 3, 5);
  } else {
    // Resting arms
    ctx.fillRect(5, baseY + 10, 3, 6);
    ctx.fillRect(24, baseY + 10, 3, 6);
  }

  // Legs
  ctx.fillStyle = palette.accent;
  ctx.fillRect(11, baseY + 20, 4, 4);
  ctx.fillRect(17, baseY + 20, 4, 4);

  // OpenClaw crown
  if (isOpenClaw) {
    ctx.fillStyle = palette.crown || '#FFD700';
    // Crown base
    ctx.fillRect(10, baseY - 4, 12, 3);
    // Crown points
    ctx.fillRect(10, baseY - 7, 2, 3);
    ctx.fillRect(15, baseY - 7, 2, 3);
    ctx.fillRect(20, baseY - 7, 2, 3);
    // Crown jewel
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(15, baseY - 5, 2, 1);
  }

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export default function CharacterSprite({ status = 'idle', paletteIndex = 0, isOpenClaw = false, size = 96, spriteSheet = null }) {
  const canvasRef = useRef(null);
  const frameRef = useRef(0);
  const animRef = useRef(null);
  const lastFrameTime = useRef(0);
  const [spriteImage, setSpriteImage] = useState(null);

  // Load sprite sheet if provided
  useEffect(() => {
    if (spriteSheet) {
      const img = new Image();
      img.onload = () => setSpriteImage(img);
      img.src = spriteSheet;
    }
  }, [spriteSheet]);

  const palette = isOpenClaw
    ? OPENCLAW_PALETTE
    : PALETTES[paletteIndex % PALETTES.length];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const animate = (time) => {
      if (time - lastFrameTime.current > 1000 / ANIMATION_FPS) {
        frameRef.current++;
        lastFrameTime.current = time;

        if (spriteImage) {
          // Draw from sprite sheet
          ctx.clearRect(0, 0, size, size);
          ctx.imageSmoothingEnabled = false;
          const row = status === 'idle' ? 0 : 1;
          const col = frameRef.current % 2;
          ctx.drawImage(
            spriteImage,
            col * FRAME_SIZE, row * FRAME_SIZE,
            FRAME_SIZE, FRAME_SIZE,
            0, 0, size, size
          );
        } else {
          // Draw procedural character
          drawProceduralCharacter(ctx, palette, frameRef.current, status, isOpenClaw, size);
        }
      }
      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [status, palette, isOpenClaw, size, spriteImage]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        imageRendering: 'pixelated'
      }}
    />
  );
}

export { PALETTES, OPENCLAW_PALETTE };
