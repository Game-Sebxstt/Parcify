import React from "react";
import useAppState from "../hooks/useAppState";

export default function ArticlePlus() {
  const { IsVisibleCreateParcellerUpdate } = useAppState();

  const showParcelContent = () => {
    IsVisibleCreateParcellerUpdate(true);
  };

  return (
    <div
      id="article-plus"
      className="bg-transparent z-[2] border-dashed flex justify-center items-center border-2 border-[#1E90FF] w-full max-w-xl h-72 cursor-pointer hover:bg-[#1E90FF] transition-all duration-300"
      onClick={showParcelContent}
      onTouchStart={showParcelContent}
    >
      <svg
        className="icon icon-tabler icons-tabler-outline icon-tabler-plus w-12"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M12 5l0 14" />
        <path d="M5 12l14 0" />
      </svg>
    </div>
  );
}
