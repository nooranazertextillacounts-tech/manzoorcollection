import React, { useEffect, useState } from 'react';
import { Download, X, Share, ExternalLink, Smartphone, Laptop, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';

export function InstallPWA({ className = '' }: { className?: string }) {
  const [supportsPWA, setSupportsPWA] = useState(false);
  const [promptInstall, setPromptInstall] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [inIframe, setInIframe] = useState(false);

  useEffect(() => {
    // Detect if running inside an iframe
    const insideIframe = window.self !== window.top;
    setInIframe(insideIframe);

    // Detect iOS
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone;
    
    setIsIOS(ios);
    
    // Always consider PWA supported or show guide for better UX
    setSupportsPWA(true);

    const handler = (e: any) => {
      e.preventDefault();
      console.log('PWA install prompt ready');
      setPromptInstall(e);
      // Auto-trigger if we were waiting for it? No, better let user click.
    };

    window.addEventListener('beforeinstallprompt', handler);

    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setSupportsPWA(false); // Hide if already installed
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const onClick = async (evt: React.MouseEvent) => {
    evt.preventDefault();
    
    // If already standalone, don't do anything
    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      toast.success("App is already installed! / ایپ پہلے سے انسٹال ہے۔");
      return;
    }

    // If we have the native prompt and not in an iframe, trigger it directly
    if (promptInstall && !inIframe && !isIOS) {
      try {
        promptInstall.prompt();
        const { outcome } = await promptInstall.userChoice;
        if (outcome === 'accepted') {
          console.log('User accepted the install prompt');
          setPromptInstall(null);
        }
      } catch (err) {
        console.error("Install prompt failed", err);
        setShowGuideModal(true);
      }
      return;
    }

    // Otherwise, show the helpful step-by-step guide
    setShowGuideModal(true);
  };

  if (!supportsPWA) return null;

  const openInNewTab = () => {
    window.open(window.location.href, '_blank');
  };

  return (
    <>
      <button
        onClick={onClick}
        type="button"
        className={`flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition shadow-md font-semibold cursor-pointer ${className}`}
      >
        <Download size={14} className="animate-bounce" />
        <span>انسٹال کریں / Install App</span>
      </button>

      {showGuideModal && (
        <div className="fixed inset-0 bg-slate-950/90 flex items-center justify-center p-4 z-[100] overflow-y-auto backdrop-blur-md">
          <div className="bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl max-w-lg w-full p-8 relative border border-white/5 my-8">
            <button 
              onClick={() => setShowGuideModal(false)}
              className="absolute top-6 right-6 text-slate-400 hover:text-white p-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X size={24} />
            </button>

            {/* Header */}
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center mb-4 border border-blue-500/20">
                <Smartphone size={32} />
              </div>
              <h3 className="text-2xl font-bold text-slate-900 dark:text-white font-serif">Install Manzoor POS 📱</h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 mt-2">انسٹال کرنے کا طریقہ / How to Install</p>
            </div>

            {/* IFrame Alert / New Tab Button */}
            {inIframe && (
              <div className="mb-8 p-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-slate-800 dark:text-zinc-100">
                <div className="flex items-start gap-4">
                  <Sparkles size={24} className="text-blue-500 shrink-0 mt-1" />
                  <div>
                    <p className="font-bold text-lg text-blue-400">نیو ٹیب میں کھولیں / Open First</p>
                    <p className="text-sm text-zinc-400 mt-2 leading-relaxed">
                      انسٹال کرنے کے لیے پہلے ایپ کو نیو ٹیب میں کھولنا لازمی ہے۔ نیچے والا بٹن دبائیں۔
                    </p>
                    <p className="text-xs text-zinc-500 mt-2">
                      To install, you must open the app in a new tab first. Click the button below:
                    </p>
                  </div>
                </div>
                <button
                  onClick={openInNewTab}
                  className="mt-6 w-full flex items-center justify-center gap-3 py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-600/20 active:scale-95 cursor-pointer"
                >
                  <ExternalLink size={18} />
                  <span>Open in New Tab & Install</span>
                </button>
              </div>
            )}

            {/* Step-by-Step Mobile vs Desktop Guides */}
            <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              
              {/* Android/Chrome */}
              <div className="p-5 bg-slate-50 dark:bg-white/5 rounded-2xl border border-white/5">
                <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-3 text-base">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <Smartphone className="text-emerald-500" size={18} />
                  </div>
                  <span>Android (Chrome)</span>
                </h4>
                <div className="mt-4 text-sm text-slate-600 dark:text-zinc-400 space-y-3">
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs shrink-0">1</span>
                    <p>اوپر کونے میں <strong>تین نقطوں (Menu)</strong> کو دبائیں۔</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs shrink-0">2</span>
                    <p>مینو سے <strong>"Install App"</strong> کو منتخب کریں۔</p>
                  </div>
                  <p className="text-xs text-zinc-500 italic pl-9">Tap 3 dots &rarr; Install App</p>
                </div>
              </div>

              {/* iOS Safari */}
              <div className="p-5 bg-slate-50 dark:bg-white/5 rounded-2xl border border-white/5">
                <h4 className="font-bold text-slate-800 dark:text-white flex items-center gap-3 text-base">
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center">
                    <Share className="text-sky-500" size={18} />
                  </div>
                  <span>iPhone / iPad (Safari)</span>
                </h4>
                <div className="mt-4 text-sm text-slate-600 dark:text-zinc-400 space-y-3">
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs shrink-0">1</span>
                    <p>نیچے موجود <strong>Share (شیئر)</strong> بٹن کو دبائیں۔</p>
                  </div>
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs shrink-0">2</span>
                    <p>نیچے جا کر <strong>"Add to Home Screen"</strong> پر کلک کریں۔</p>
                  </div>
                  <p className="text-xs text-zinc-500 italic pl-9">Tap Share &rarr; Add to Home Screen</p>
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="mt-8 pt-6 border-t border-white/5 flex gap-3">
              <button
                onClick={() => setShowGuideModal(false)}
                className="flex-1 py-4 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-xl text-sm font-bold transition cursor-pointer"
              >
                Close / بند کریں
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
