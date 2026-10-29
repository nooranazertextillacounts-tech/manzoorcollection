import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Hammer, Wrench, HardHat, Cog } from 'lucide-react';

export function UnderDevelopment() {
  const [timeLeft, setTimeLeft] = useState<{ hours: number, minutes: number, seconds: number } | null>(null);

  useEffect(() => {
    // Target 9:00 PM today. It runs locally in client's browser so we use local time
    const target = new Date();
    target.setHours(21, 0, 0, 0);

    // If it's already past 9 PM, maybe target next day? 
    if (target.getTime() < new Date().getTime()) {
      target.setDate(target.getDate() + 1);
    }

    const interval = setInterval(() => {
      const now = new Date();
      const diff = target.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0 });
        clearInterval(interval);
      } else {
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / 1000 / 60) % 60);
        const s = Math.floor((diff / 1000) % 60);
        setTimeLeft({ hours: h, minutes: m, seconds: s });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-4 overflow-hidden relative">
      {/* Animated background elements */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        className="absolute -top-40 -left-40 text-slate-800 dark:text-slate-100 opacity-20"
      >
        <Cog className="w-[400px] h-[400px]" />
      </motion.div>
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 35, repeat: Infinity, ease: "linear" }}
        className="absolute -bottom-40 -right-40 text-slate-800 dark:text-slate-100 opacity-20"
      >
        <Cog className="w-[400px] h-[400px]" />
      </motion.div>

      <div className="z-10 text-center space-y-8 max-w-2xl mx-auto w-full">
        {/* Animated Workers */}
        <div className="flex justify-center gap-8 mb-10 text-slate-300">
          <motion.div
            animate={{ 
              rotate: [0, -30, 10, -30, 0],
              y: [0, -5, 0, -5, 0]
            }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
            className="flex flex-col items-center gap-2"
          >
            <Hammer className="w-12 h-12 text-sky-400" />
          </motion.div>
          <motion.div
            animate={{ 
              rotate: [0, 45, 0, 45, 0],
              y: [0, -10, 0]
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
            className="flex flex-col items-center gap-2"
          >
            <Wrench className="w-12 h-12 text-amber-400" />
          </motion.div>
          <motion.div
            animate={{ 
              scale: [1, 1.1, 1],
              y: [0, -8, 0]
            }}
            transition={{ duration: 2, repeat: Infinity, ease: "easeInOut", delay: 1 }}
            className="flex flex-col items-center gap-2"
          >
            <HardHat className="w-12 h-12 text-emerald-400" />
          </motion.div>
        </div>

        {/* Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="bg-slate-800/80 backdrop-blur-xl p-8 md:p-12 rounded-3xl border border-slate-700 shadow-2xl relative overflow-hidden"
        >
          {/* subtle shine effect overlay */}
          <motion.div 
            animate={{ left: ['-100%', '200%'] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 5 }}
            className="absolute top-0 bottom-0 w-1/2 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12"
          />

          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">
            System Upgrade <br/><span className="text-sky-400">In Progress</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 mb-10 leading-relaxed font-medium">
            App is currently under development.<br/> Please wait, we are working hard behind the scenes!
          </p>

          <div className="flex justify-center flex-wrap gap-4 text-white">
            <div className="bg-slate-900 rounded-2xl p-4 w-24 md:w-28 border border-slate-700 shadow-inner">
              <div className="text-3xl md:text-4xl font-black font-mono text-white mb-1">
                {String(timeLeft?.hours || 0).padStart(2, '0')}
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-semibold">Hours</div>
            </div>
            <div className="text-4xl font-bold text-slate-600 dark:text-slate-300 mt-3 hidden sm:block">:</div>
            <div className="bg-slate-900 rounded-2xl p-4 w-24 md:w-28 border border-slate-700 shadow-inner">
              <div className="text-3xl md:text-4xl font-black font-mono text-white mb-1">
                {String(timeLeft?.minutes || 0).padStart(2, '0')}
              </div>
              <div className="text-[10px] text-slate-400 uppercase tracking-[0.2em] font-semibold">Mins</div>
            </div>
            <div className="text-4xl font-bold text-slate-600 dark:text-slate-300 mt-3 hidden sm:block">:</div>
            <div className="bg-slate-900 rounded-2xl p-4 w-24 md:w-28 border border-slate-700 shadow-inner">
              <div className="text-3xl md:text-4xl font-black font-mono text-sky-400 mb-1">
                {String(timeLeft?.seconds || 0).padStart(2, '0')}
              </div>
              <div className="text-[10px] text-sky-500/70 uppercase tracking-[0.2em] font-semibold">Secs</div>
            </div>
          </div>
          
          <div className="mt-10 inline-flex items-center gap-2 px-4 py-2 bg-slate-900/50 rounded-full border border-slate-700 text-sm font-medium text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Estimated completion: Today at 9:00 PM
          </div>
        </motion.div>

        {/* Little loading dots style 'workers' */}
        <div className="flex justify-center items-center gap-2 mt-8">
          <span className="text-slate-500 dark:text-slate-400 text-sm font-semibold tracking-widest uppercase items-center flex">
            Little laborers working
            <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0 }} className="ml-3 w-1.5 h-1.5 bg-sky-500 rounded-full inline-block"></motion.span>
            <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }} className="ml-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full inline-block"></motion.span>
            <motion.span animate={{ opacity: [0, 1, 0] }} transition={{ duration: 1.5, repeat: Infinity, delay: 1 }} className="ml-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block"></motion.span>
          </span>
        </div>
      </div>
    </div>
  );
}
