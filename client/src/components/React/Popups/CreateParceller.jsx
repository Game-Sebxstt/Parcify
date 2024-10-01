import React, { useRef, useEffect } from 'react';
import TemplateView from '../components/TemplateView';
import Templates from '../Sections/Categories/Templates';
import * as environment_utils from '../../../js/globals/environment-utils';
import useAppState from '../hooks/useAppState';

const TemplatePopup = ({ id_content }) => {
    const { isVisibleCreateParceller, IsVisibleCreateParcellerUpdate, templates, TemplatesUpdate } = useAppState();

    const handleClose = () => {
        IsVisibleCreateParcellerUpdate(false);
    };

    if (!isVisibleCreateParceller) return null;

    return (
    <div id={id_content} className="content-all fixed z-50 flex animate-deployment justify-center items-center w-full h-full px-3">
        <div id="close-bg" className="w-full h-full absolute top-0 left-0 cursor-pointer bg-black/80 z-0" onClick={handleClose}></div>
        
        <div className="bg-[#2c2c2c] w-full max-w-5xl h-[95%] shadow-gray-900 rounded-lg z-10 flex flex-col">
        <header className="px-5 py-3 border-b border-[#1E90FF] flex flex-row items-center justify-between">
            <div className="flex items-center gap-1">
            <img src="/Logo-no-background-no-text.png" className="h-10" alt="Logo" />
            <h3 className="text-xl font-bold text-white">Parcify</h3>
            </div>
            
            <button id="close-button" type="button" onClick={handleClose} className="text-gray-400 hover:bg-gray-200 hover:text-gray-900 rounded-lg w-8 h-8 inline-flex justify-center items-center">
            <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
            </svg>
            </button>
        </header>
        
        <section className="w-full h-full px-5 py-3 gap-y-3 overflow-x-auto">
            <Templates category='Recomendados'>
            {templates.length > 0 ? (
                templates.map((template) => (
                <TemplateView
                    key={template.template_id}
                    id="template"
                    first_text={template.name}
                    second_text={template.autor}
                    url_image={template.preview}
                    template_id={template.template_id}
                    description={template.description}
                    likes={template.likes}
                    date_create={template.date_create}
                />
                ))
            ) : (
                <p>No templates available</p>
            )}
            </Templates>
        </section>
        </div>
    </div>
    );
};

export default TemplatePopup;