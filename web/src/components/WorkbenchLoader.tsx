"use client";

import dynamic from "next/dynamic";

const Workbench = dynamic(() => import("./Workbench").then((module) => module.Workbench), { ssr: false });

export function WorkbenchLoader() {
  return <Workbench />;
}
