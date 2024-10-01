import React from 'react';
import { formatNumber } from '../../../js/globals/astro-utils';
import useAppState from '../hooks/useAppState';

const TemplateView = ({ 
  id, 
  first_text, 
  second_text, 
  url_image, 
  template_id, 
  description, 
  likes, 
  date_create 
}) => {
  const formatLikes = likes ? formatNumber(JSON.parse(likes).length || 0) : null;
  const { TittleUpdate, AuthorUpdate, DescriptionUpdate, PreviewUpdate, TemplateIdUpdate } = useAppState();

  const showPreview = (e) => {
    const parent = e.target.closest(".create-template");
    const dataId = parent.getAttribute("data-id");
    const dataName = parent.getAttribute("data-name");
    const dataPreview = parent.getAttribute("data-preview");
    const dataAuthor = parent.getAttribute("data-author");
    const dataDescription = parent.getAttribute("data-description");

    TittleUpdate(dataName);
    AuthorUpdate(dataAuthor);
    DescriptionUpdate(dataDescription);
    PreviewUpdate(dataPreview);
    TemplateIdUpdate(dataId);
    window.getComputedStyle(document.getElementById("previewTemplate")).display == "none" ? document.getElementById("previewTemplate").style.display = "flex" : document.getElementById("previewTemplate").style.display = "none";
  }

  return (
    <div 
      id={id} 
      data-id={template_id} 
      data-name={first_text} 
      data-preview={url_image} 
      data-author={second_text} 
      data-description={description} 
      data-likes={likes} 
      data-create={date_create} 
      className="create-template template w-full h-fit cursor-pointer"
      onClick={showPreview}
    >
      <div className="w-full h-72 relative">
        {url_image !== "../../../placeholder/image_preview.svg" ? (
          <div className="w-full h-full absolute top-0 left-0">
            <img src={url_image} className="w-full h-full" alt={first_text} />
          </div>
        ) : (
          <div className="bg-[#E6E6E6] w-full h-full absolute top-0 left-0">
            <img src={url_image} className="w-full h-full" alt="Placeholder" />
          </div>
        )}
        <div className="w-full h-full flex justify-center items-center mb-2 border-2 border-transparent cursor-pointer transition-all duration-[500] ease-in hover:border-[#1E90FF] hover:bg-[#1E90FF]/70 [&>svg]:hover:opacity-100 absolute top-0 left-0">
          <svg className="icon icon-tabler icons-tabler-outline icon-tabler-plus w-12 opacity-0 transition-all duration-[500] ease-in" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
            <path d="M12 5l0 14" />
            <path d="M5 12l14 0" />
          </svg>
        </div>
      </div>
      
      <div className="flex justify-start gap-5 items-center relative p-2 bg-[#1E1E1E] rounded-b-md">
        <img src="../../../Logo-no-background-no-text.png" className="h-12 max-xl:h-10" alt="Logo" />
        <div className="w-full h-full flex justify-between pr-2">
          <div className="flex flex-col">
            <h3 className="text-white text-xl font-bold max-xl:text-lg">{first_text}</h3>
            <h4 className="text-gray-300 text-lg max-xl:text-base">{second_text}</h4>
          </div>
          
          {formatLikes === null ? (
            <span></span>
          ) : (
            <div className="flex items-center gap-1 justify-between">
              <h3 className="text-white text-sm font-bold max-xl:text-sm">{formatLikes}</h3>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ffffff">
                <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                <path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateView;