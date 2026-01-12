"use client";
import dynamic from "next/dynamic";

// const ModelBuilding3D = dynamic(() => import("./ModelBuilding3D"), { ssr: false });
const SvgFloorplan = dynamic(() => import("./SvgFloorplan"), { ssr: false });

export default function VisualClient() {
  // 切换为 SVG 模式
  // const modelUrl = searchParams.get("model") || "/topoexport_3D_modeling.gltf";
  
  return (
    <div className="relative h-full w-full">
      <SvgFloorplan />
      {/* <ModelBuilding3D 
        modelUrl={modelUrl} 
        initialOrbit="-45deg 55deg 100m" 
        initialTarget="0m 0m 0m"
      /> */}
    </div>
  );
}
