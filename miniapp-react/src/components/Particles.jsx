import { useEffect, useRef, useState } from "react";

function useLiteParticles() {
  const [lite, setLite] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;

    const media = window.matchMedia("(max-width: 768px), (pointer: coarse), (prefers-reduced-motion: reduce)");
    const apply = () => setLite(media.matches);
    apply();

    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, []);

  return lite;
}

export default function Particles() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const lite = useLiteParticles();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext("2d");
    const particleCount = lite ? 24 : 40;
    const particles = Array.from({ length: particleCount }, () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * (lite ? 0.16 : 0.32),
      vy: (Math.random() - 0.5) * (lite ? 0.16 : 0.32),
    }));

    const resize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.5);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const onMove = (event) => {
      mouseRef.current = { x: event.clientX, y: event.clientY };
    };

    const onLeave = () => {
      mouseRef.current = { x: -9999, y: -9999 };
    };

    let frameId = 0;

    const render = () => {
      if (document.visibilityState === "hidden") {
        frameId = requestAnimationFrame(render);
        return;
      }

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (const particle of particles) {
        const mouseDx = particle.x - mouseRef.current.x;
        const mouseDy = particle.y - mouseRef.current.y;
        const mouseDist = Math.hypot(mouseDx, mouseDy);

        if (!lite && mouseDist < 120) {
          const force = (120 - mouseDist) / 1700;
          particle.vx += (mouseDx / (mouseDist || 1)) * force;
          particle.vy += (mouseDy / (mouseDist || 1)) * force;
        }

        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vx *= 0.994;
        particle.vy *= 0.994;

        if (Math.abs(particle.vx) < 0.05) particle.vx += (Math.random() - 0.5) * 0.012;
        if (Math.abs(particle.vy) < 0.05) particle.vy += (Math.random() - 0.5) * 0.012;

        if (particle.x <= 0 || particle.x >= canvas.width) particle.vx *= -1;
        if (particle.y <= 0 || particle.y >= canvas.height) particle.vy *= -1;

        ctx.fillStyle = lite ? "rgba(255,255,255,0.34)" : "rgba(0,152,234,0.32)";
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, lite ? 1.15 : 1.35, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i += 1) {
        for (let j = i + 1; j < particles.length; j += 1) {
          const a = particles[i];
          const b = particles[j];
          const maxLinkDist = lite ? 54 : 82;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);

          if (dist < maxLinkDist) {
            ctx.strokeStyle = lite
              ? `rgba(255,255,255,${0.06 * (1 - dist / maxLinkDist)})`
              : `rgba(0,152,234,${0.07 * (1 - dist / maxLinkDist)})`;
            ctx.lineWidth = lite ? 0.8 : 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      frameId = requestAnimationFrame(render);
    };

    resize();
    window.addEventListener("resize", resize);
    if (!lite) {
      window.addEventListener("mousemove", onMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
    }
    render();

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
    };
  }, [lite]);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" />;
}
