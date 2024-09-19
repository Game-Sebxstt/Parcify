import * as req from '../../backend/requests'
import * as front from '../front'
import * as environment_utils from '../../globals/environment-utils'

const url_params = new URLSearchParams(window.location.search);

function hasTemplate(){
    const has_template_params = url_params.has("template_id")

    if(has_template_params){
        const template_params = url_params.get("template_id");
        
        let template = environment_utils.getTemplate(template_params);
    
        if(!template){
            front.utils.handleError("Template not found");
            return
        }

        const dataId = template.template_id;
        const dataName = template.name;
        const dataAuthor = template.autor;
        const dataPreview = template.preview;
        const dataDescription = template.description;
  
        
    }
}

hasTemplate();