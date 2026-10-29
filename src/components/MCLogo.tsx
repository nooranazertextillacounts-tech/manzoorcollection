import React from 'react';
import { motion } from 'motion/react';

export function MCLogo({ className = "w-12 h-12" }: { className?: string }) {
  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-gradient-to-tr from-zinc-950 via-zinc-900 to-zinc-800 shadow-[0_0_20px_rgba(0,0,0,0.5)] border border-white/10 ${className}`}>
      {/* Animated Sheen Background */}
      <motion.div
        className="absolute inset-0 w-[200%] h-[200%] bg-gradient-to-tr from-transparent via-blue-200/10 to-transparent skew-x-12"
        animate={{
          x: ['-150%', '150%'],
        }}
        transition={{
          repeat: Infinity,
          duration: 4,
          ease: "linear",
          repeatDelay: 3
        }}
      />
      
      {/* Glowing inner orb */}
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-blue-500/10 blur-xl rounded-full" />
      
      <div className="relative flex items-center tracking-tighter -ml-0.5 z-10 drop-shadow-lg">
        <motion.span
          initial={{ y: -10, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.1, type: "spring", stiffness: 100 }}
          className="text-white font-serif font-light tracking-widest"
          style={{ fontSize: "1.6em", lineHeight: 1 }}
        >
          M
        </motion.span>
        <motion.span
          initial={{ y: 10, opacity: 0, scale: 0.8 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.3, type: "spring", stiffness: 100 }}
          className="text-blue-400 font-serif font-medium italic -ml-1"
          style={{ fontSize: "1.8em", lineHeight: 1 }}
        >
          C
        </motion.span>
      </div>
      
      {/* Sparkle */}
      <motion.div
        className="absolute top-1.5 right-1.5 w-0.5 h-0.5 bg-blue-200 rounded-full shadow-[0_0_8px_2px_rgba(59,130,246,0.6)]"
        animate={{
          scale: [0, 1.5, 0],
          opacity: [0, 1, 0]
        }}
        transition={{
          repeat: Infinity,
          duration: 3,
          repeatDelay: 2,
          ease: "easeInOut"
        }}
      />
    </div>
  );
}
