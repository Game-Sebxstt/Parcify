import React from 'react';

const Templates = ({ category, children }) => {
  return (
    <div className="w-full h-fit">
      <header className="w-full h-fit flex justify-between items-center py-3 px-2">
        <span className="text-white font-bold text-lg">
          {category}
        </span>
      </header>
      
      <section className="w-full h-fit grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
        {children}
      </section>
    </div>
  );
};

export default Templates;