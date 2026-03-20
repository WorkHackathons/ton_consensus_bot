import { motion } from "framer-motion";

const blobs = [
  {
    color: "#06111F",
    size: 420,
    className: "left-[-140px] top-[-110px]",
    animate: { x: [-18, 18, -18], y: [-12, 12, -12] },
    transition: { duration: 12, repeat: Infinity, ease: "easeInOut" },
  },
  {
    color: "#12081F",
    size: 360,
    className: "bottom-[-120px] right-[-90px]",
    animate: { x: [12, -12, 12], y: [16, -16, 16] },
    transition: { duration: 14, repeat: Infinity, ease: "easeInOut" },
  },
  {
    color: "#071A20",
    size: 320,
    className: "right-[12%] top-[30%]",
    animate: { x: [-8, 18, -8], y: [8, -18, 8] },
    transition: { duration: 16, repeat: Infinity, ease: "easeInOut" },
  },
];

export default function Background() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {blobs.map((blob) => (
        <motion.div
          key={blob.color}
          className={`absolute rounded-full blur-[80px] ${blob.className}`}
          style={{ width: blob.size, height: blob.size, background: blob.color }}
          animate={blob.animate}
          transition={blob.transition}
        />
      ))}
      <div className="absolute inset-0 bg-black/88" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.03),transparent_38%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.018)_22%,transparent_38%,transparent_62%,rgba(0,152,234,0.045)_82%,transparent_100%)] opacity-80" />
      <div className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.035),transparent_58%)]" />
    </div>
  );
}
