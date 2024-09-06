import * as req from '../../backend/requests'
import * as globals from '../utilities/globals'
import * as reusable from '../utilities/reusable'
import * as front from '../front'

const url_params = new URLSearchParams(window.location.search);

async function hasTemplate(){
    const has_template_params = url_params.has("template_id")

    if(has_template_params){
        const template_params = url_params.get("template_id");
        
        let template = await req.getTemplate(template_params)
    
        if(!template.state){
            front.utils.handleError(template);
            return
        }

        template = template.data.message

        const dataId = template.template_id;
        const dataName = template.name;
        const dataAuthor = template.autor;
        const dataPreview = template.preview;
        const dataDescription = template.description;
  
        front.utils.showPreviewTemplate({
          dataId,
          dataName,
          dataAuthor,
          dataPreview,
          dataDescription
        })
     
    }
}

await hasTemplate();