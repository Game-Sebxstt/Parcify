import React, { useState } from 'react';
import * as astro_utils from '../../../js/globals/astro-utils';
import * as front from '../../../js/frontend/front';

const Article = ({ id, id_project, id_element, name, last_modified, project_id, preview }) => {
  const onClickMetric = (e) => {
    front.utils.showAnalytics(e.target)
  }

  return (
    <div className={`w-full max-w-xl h-fit relative ${id}`} data-name={name} data-modified={last_modified}>
      <div
        id={id_project || "element-project"}
        data-id={project_id}
        data-id-element={id_element}
        className="bg-transparent border-2 border-transparent hover:border-[#1E90FF]/70 hover:bg-[#1E90FF]/30 mb-2 absolute cursor-pointer w-full h-72 z-10"
        onClick={onClickMetric}
      ></div>

      <div className="bg-[#f5f5f5] relative cursor-pointer w-full h-72">
        {preview ? (
          <img src={preview} className="w-full h-full object-cover" alt="Project Preview" />
        ) : (
          <img src="../../../placeholder/image_preview.svg" className="w-full h-full" alt="Placeholder" />
        )}
      </div>

      <div className="flex justify-between w-full items-center p-2 bg-[#1f1f1f] rounded-b-md">
        <div className="flex flex-col w-full gap-y-1">
          <div className="w-full flex gap-x-2 items-center">
            {astro_utils.isNewProject(last_modified) && (
              <span className="bg-[#1E90FF] p-1 rounded-md text-sm text-white">
                Nuevo
              </span>
            )}
            <h3 className="name-of-parcel text-white pb-1 text-xl font-bold truncate w-full">
              {name}
            </h3>
          </div>

          <h4 className="text-gray-300 text-lg">
            Editado hace {astro_utils.lastModified([last_modified])}
          </h4>
        </div>
      </div>

      <div
        id="selectionIdentifier"
        className="hidden border-[3px] border-[#1E90FF]/70 bg-transparent mb-2 absolute top-0 cursor-pointer w-full h-72 z-9"
      ></div>
    </div>
  );
};

export default Article;
