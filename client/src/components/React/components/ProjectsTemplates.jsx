import React,{ useRef, useEffect } from "react";
import { generateID } from "../../../js/globals/astro-utils.js";
import * as environment_utils from "../../../js/globals/environment-utils.js";
import useAppState from "../hooks/useAppState.js";
import TemplateView from "./TemplateView.jsx";

export default function ProjectsTemplates() {
    const { templates, TemplatesUpdate } = useAppState();
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

    return (
        <div id="content-grid-templates" data-section="templates" className="w-full grid grid-cols-3 max-xl:grid-cols-2 max-[980px]:grid-cols-1 gap-5 gap-y-10 overflow-hidden">
            {
                templates.length > 0 ? (
                    templates.map((template) => (
                        <TemplateView
                            client:only="react"
                            key={generateID()}
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
                )
            }
        </div>
    );
}
