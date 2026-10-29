import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Clock, ArrowRight, Sparkles } from 'lucide-react';
import { Link } from 'react-router';

export function MaintenanceOverlay() {
  // 24 hour countdown timer
  const [timeLeft, setTimeLeft] = useState(24 * 60 * 60);

  useEffect(() => {
    // Read from localStorage to keep it consistent on reload
    const storedEndTime = localStorage.getItem('maintenance_end_time');
    let endTime: number;
    
    if (storedEndTime) {
      endTime = parseInt(storedEndTime, 10);
    } else {
      endTime = Date.now() + 24 * 60 * 60 * 1000;
      localStorage.setItem('maintenance_end_time', endTime.toString());
    }

    const updateTimer = () => {
      const now = Date.now();
      const difference = Math.floor((endTime - now) / 1000);
      
      if (difference <= 0) {
        setTimeLeft(0);
      } else {
        setTimeLeft(difference);
      }
    };

    updateTimer();
    const intervalId = setInterval(updateTimer, 1000);
    return () => clearInterval(intervalId);
  }, []);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full h-full min-h-[calc(100vh-4rem)] bg-zinc-950 flex flex-col items-center justify-center p-8 text-white relative overflow-hidden">
      {/* Premium Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full max-w-4xl bg-gradient-to-b from-blue-500/10 via-transparent to-transparent opacity-60 blur-[100px]" />
        <div className="absolute bottom-0 right-0 w-[50%] h-[50%] bg-blue-900/20 blur-[120px] rounded-full mix-blend-screen" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="relative z-10 w-full max-w-2xl text-center space-y-10"
      >
        <div className="flex justify-center">
          <div className="inline-flex items-center justify-center p-5 rounded-full bg-zinc-900/80 border border-white/5 shadow-[0_0_40px_rgba(59,130,246,0.1)] mb-2 backdrop-blur-sm">
            <Sparkles className="w-12 h-12 text-blue-400" />
          </div>
        </div>

        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-serif tracking-wide text-white font-light">
            System <span className="font-medium text-blue-500 italic">Upgrade</span>
          </h1>
          <p className="text-lg text-zinc-400 max-w-lg mx-auto font-light tracking-wide leading-relaxed">
            We are currently integrating new premium features and optimizing our infrastructure for a better experience.
          </p>
        </div>

        {/* Timer Box */}
        <div className="flex justify-center">
          <div className="bg-zinc-900/40 border border-white/10 backdrop-blur-xl rounded-3xl p-8 min-w-[340px] shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/5 via-transparent to-white/5 pointer-events-none" />
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-blue-400/80">
                <Clock className="w-4 h-4" />
                <span className="text-xs uppercase tracking-widest font-medium">Estimated Time Remaining</span>
              </div>
              <div className="text-5xl md:text-6xl font-mono font-light tracking-widest text-white drop-shadow-md">
                {formatTime(timeLeft)}
              </div>
            </div>
          </div>
        </div>

        {/* Call to Action */}
        <div className="pt-8 flex flex-col items-center gap-6">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl px-6 py-4 inline-flex items-center gap-4 text-blue-200/90 max-w-md text-left shadow-inner">
            <span className="text-sm font-light leading-relaxed">
              Currently, only the <strong className="font-medium text-blue-400">Sales, Labour, Payroll &amp; Inventory</strong> modules are active. Other services will resume shortly.
            </span>
          </div>
          
          <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-4">
            <Link 
              to="/sales"
              className="group inline-flex items-center justify-center gap-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 text-white px-8 py-4 rounded-xl font-medium transition-all shadow-[0_4px_20px_rgba(37,99,235,0.3)] hover:shadow-[0_4px_30px_rgba(37,99,235,0.4)] uppercase tracking-widest text-sm"
            >
              Sales
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              to="/inventory"
              className="group inline-flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-4 rounded-xl font-medium transition-all border border-zinc-700 hover:border-zinc-600 uppercase tracking-widest text-sm"
            >
              Inventory
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              to="/employees"
              className="group inline-flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-4 rounded-xl font-medium transition-all border border-zinc-700 hover:border-zinc-600 uppercase tracking-widest text-sm"
            >
              Labour
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link 
              to="/payroll"
              className="group inline-flex items-center justify-center gap-3 bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-4 rounded-xl font-medium transition-all border border-zinc-700 hover:border-zinc-600 uppercase tracking-widest text-sm"
            >
              Payroll
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>

      </motion.div>
    </div>
  );
}
