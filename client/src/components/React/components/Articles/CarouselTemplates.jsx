import React, { useEffect, useRef } from 'react';
import useAppState from '../../hooks/useAppState';
import Splide from '@splidejs/splide';
import '@splidejs/splide/dist/css/splide.min.css';

const CarouselTemplates = () => {
  const { templates, TemplatesUpdate } = useAppState();
  const { TittleUpdate, AuthorUpdate, DescriptionUpdate, PreviewUpdate, TemplateIdUpdate } = useAppState();
  const splideRef = useRef(null);
  const progressBarRef = useRef(null);
  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      const defaultTemplate = {
        name: "Plantilla Vacia",
        template_id: 0,
        preview: "../../../placeholder/image_preview.svg",
        description: "Plantilla Vacia.",
        autor: "Parcify",
        likes: null,
      };
      TemplatesUpdate([...templates, defaultTemplate]);
    }
  }, []);

  useEffect(() => {
    if (templates.length > 0 && splideRef.current) {
      const options = {
        type: 'loop',
        fixedWidth: '100%',
        height: '100%',
        focus: 'center',
        keyboard: 'global',
        perPage: 1,
        wheel: false,
        autoplay: true,
        pauseOnHover: true,
        arrows: false,
        pagination: true,
      };

      const splide = new Splide(splideRef.current, options);
      const bar = progressBarRef.current;

      splide.on('mounted move', function () {
        const end = splide.Components.Controller.getEnd() + 1;
        const rate = Math.min((splide.index + 1) / end, 1);
        bar.style.width = `${100 * rate}%`;
      });

      splide.mount();

      return () => {
        splide.destroy();
      };
    }
  }, [templates]);

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
    <div className="w-full max-w-3xl h-full">
      <div ref={splideRef} className="splide w-full h-full">
        <div className="splide__track w-full h-full">
          <ul className="splide__list w-full h-full">
            {templates.length > 0 ? (
              templates.map((template, index) => (
                <li
                  key={index}
                  className="splide__slide w-full h-full"
                  data-splide-interval="3000"
                >
                  <div className="w-full h-full bg-[#1E1E1E] flex justify-center items-center text-[24px] text-black cursor-pointer relative">
                    {template.preview !== "../../../placeholder/image_preview.svg" ? (
                        <img src={template.preview} alt={template.name} className="w-full h-full object-cover" />  
                    ) : (
                        <img src={template.preview} alt="Placeholder" className="w-full h-full" />
                    )}
                    <div
                      data-id={template.template_id}
                      data-name={template.name}
                      data-preview={template.preview}
                      data-author={template.autor}
                      data-description={template.description}
                      className="background-animation w-full h-full absolute hover:bg-[#1E1E1E]/60 transition-all ease duration-300 create-template"
                      onClick={showPreview}
                    />
                    <span className="absolute bottom-8 left-5 text-white">
                      {template.name}
                    </span>
                  </div>
                </li>
              ))
            ) : (
              <p>No templates available</p>
            )}
          </ul>
        </div>
        <div className="my-carousel-progress">
          <div ref={progressBarRef} className="my-carousel-progress-bar bg-[#1E90FF] h-0.5 transition-all duration-[400] w-0" />
        </div>
      </div>
    </div>
  );
};

export default CarouselTemplates;