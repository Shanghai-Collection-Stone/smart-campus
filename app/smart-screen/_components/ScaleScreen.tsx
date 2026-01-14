"use client";

import { useEffect, useState, useRef, ReactNode } from "react";

interface ScaleScreenProps {
  width?: number;
  height?: number;
  children: ReactNode;
}

export default function ScaleScreen({ width = 1920, height = 1080, children }: ScaleScreenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLargeScreen, setIsLargeScreen] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      
      // 平板及以下设备（例如宽度小于 1024）不进行缩放，采用流式布局
    if (w < 1024) {
      setIsLargeScreen(false);
      if (containerRef.current) {
          containerRef.current.style.transform = "none";
          containerRef.current.style.width = "100%";
          containerRef.current.style.height = "auto";
        }
        return;
      }
      
      setIsLargeScreen(true);
      
      const sX = w / width;
      const sY = h / height;
      
      if (containerRef.current) {
        containerRef.current.style.transform = `scale(${sX}, ${sY})`;
        containerRef.current.style.width = `${width}px`;
        containerRef.current.style.height = `${height}px`;
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [width, height]);

  return (
    <div 
      className={`fixed inset-0 bg-[#08090c] ${isLargeScreen ? 'overflow-hidden' : 'overflow-auto'}`}
    >
      <div
        ref={containerRef}
        className={`origin-top-left transition-transform duration-200 ease-linear ${isLargeScreen ? '' : 'w-full h-auto'}`}
        style={isLargeScreen ? {
          width: width,
          height: height,
        } : {}}
      >
        {children}
      </div>
    </div>
  );
}
