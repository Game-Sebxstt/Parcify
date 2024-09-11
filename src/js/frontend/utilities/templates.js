import * as globals from '../utilities/globals'
import * as reusable from '../utilities/reusable'
import * as front from '../front'
import * as req from '../../backend/requests'

const inputEmail = document.createElement('input');
inputEmail.type = "email";
inputEmail.id = "new-email";
inputEmail.name = "new-email";
inputEmail.className = "w-[50%] opacity-70 bg-[#1E1E1E] text-gray-200 rounded-md px-4 py-2 outline-none mt-1 max-sm:w-full max-sm:text-xs max-sm:mt-2 max-md:w-[70%] max-md:text-[12.9px]";  
inputEmail.placeholder = "Enter your new email";

export function getCloneInputEmail(parent){
    if(parent){
        const inputEmailClone = inputEmail.cloneNode(true);
        parent.appendChild(inputEmailClone);
        return inputEmailClone;
    }
    
    return inputEmail.cloneNode(true);
}

export function renderProject(props, parent, depuring = true){
    let {
        name,
        last_modified,
        project_id,
        preview,
    } = props;

    if(!preview){
        preview = "../../../placeholder/image_preview.svg";
    }

    const divContent = document.createElement("div");
    divContent.className = "w-full h-fit relative project";
    divContent.setAttribute("data-name", props.name);
    divContent.setAttribute("data-modified", props.last_modified);

    const elementProject = document.createElement("div");
    elementProject.id = "element-project";
    elementProject.className = "bg-transparent border-2 border-transparent hover:border-[#1E90FF]/70 hover:bg-[#1E90FF]/30 mb-2 absolute cursor-pointer w-full h-72 z-10";
    elementProject.setAttribute("data-id", project_id);
    elementProject.setAttribute("data-id-element", globals.generateID());

    const selectionIdentifier = document.createElement("div");
    selectionIdentifier.id = "selectionIdentifier";
    selectionIdentifier.className = "hidden border-2 border-[#1E90FF]/70 mb-2 absolute top-0 cursor-pointer w-full h-72 z-9";

    const divImage = document.createElement("div");
    divImage.className = "bg-[#f5f5f5] relative cursor-pointer w-full h-72";

    const imgPreview = document.createElement("img");
    imgPreview.className = "w-full h-full"
    imgPreview.src = preview;

    const divInfo = document.createElement("div");
    divInfo.className = "flex justify-between w-full items-center p-2 bg-[#1E1E1E] rounded-b-md";

    const divInfoInter = document.createElement("div");
    divInfoInter.className = "flex flex-col w-full gap-y-1";

    const divInfoTop = document.createElement("div");
    divInfoTop.className = "w-full flex gap-x-2";

    const new_project = document.createElement("span");
    new_project.className = "bg-[#1E90FF] p-1 rounded-md text-sm";
    new_project.innerHTML = "Nuevo";

    const h3Name = document.createElement("h3");
    h3Name.className = "name-of-parcel text-white text-xl font-bold max-xl:text-lg truncate w-full";
    h3Name.textContent = name;

    const inputName = document.createElement("input");
    inputName.type = "text";
    inputName.className = "input-of-parcel bg-transparent hidden text-white outline-none pb-1 border-b-2 border-[#383838] hover:border-[#1E90FF] ease duration-150 text-xl font-bold max-xl:text-lg truncate w-full";
    inputName.value = name;

    const h4LastModified = document.createElement("h4");
    h4LastModified.className = "text-gray-300 text-lg max-xl:text-base";
    h4LastModified.textContent = `Editado hace ${globals.lastModified([last_modified])}`;

    divContent.appendChild(elementProject);
    divContent.appendChild(divImage);
    divContent.appendChild(divInfo);
    divContent.appendChild(selectionIdentifier);

    divImage.appendChild(imgPreview);

    divInfo.appendChild(divInfoInter);
    divInfoInter.appendChild(divInfoTop);
    
    if(globals.isNewProject(last_modified)){
        divInfoTop.appendChild(new_project);
    }

    divInfoTop.appendChild(h3Name);
    divInfoTop.appendChild(inputName);
    divInfoInter.appendChild(h4LastModified);

    parent.appendChild(divContent);

    document.querySelector("#close-bg").parentNode.style.display = "none";
    document.querySelector("#previewTemplate").style.display = "none";

    // Event listeners
    reusable.eventsListenerProjects();
    if(depuring){
        front.utils.handleError("Project rendered successfully");
    }

    return divContent;
}

export function renderTemplate(props, parent, depuring = true){
    let {
        template_id,
        name,
        author,
        preview,
        description,
        likes,
    } = props;

    if(!preview){
        preview = "../../../placeholder/image_preview.svg";
    }

    const divContent = document.createElement("div");
    divContent.className = "create-template template w-full h-fit cursor-pointer"
    divContent.setAttribute("data-id", Number(template_id));
    divContent.setAttribute("data-name", name);
    divContent.setAttribute("data-author", author);
    divContent.setAttribute("data-preview", preview);
    divContent.setAttribute("data-likes", likes);
    divContent.setAttribute("data-description", description);

    const divTemplate = document.createElement("div");
    divTemplate.className = "w-full h-72 relative"

    const divImage = document.createElement("div");
    divImage.className = "w-full h-full absolute top-0 left-0"

    if(preview === "../../../placeholder/image_preview.svg"){
        divImage.className = "bg-[#E6E6E6] w-full h-full absolute top-0 left-0"
    }

    const imgPreview = document.createElement("img");
    imgPreview.className = "w-full h-full"
    imgPreview.src = preview;

    const divSVG = document.createElement("div");
    divSVG.className = "w-full h-full flex justify-center items-center border-2 border-transparent cursor-pointer transition-all duration-[500] ease-in hover:border-[#1E90FF] hover:bg-[#1E90FF]/70 [&>svg]:hover:opacity-100 absolute top-0 left-0"

    divSVG.innerHTML = `
        <svg class="icon icon-tabler icons-tabler-outline icon-tabler-plus w-12 opacity-0 transition-all duration-[500] ease-in" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"  fill="none"  stroke="white"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round">
          <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
          <path d="M12 5l0 14" />
          <path d="M5 12l14 0" />
        </svg>
    `

    const divInfo = document.createElement("div");
    divInfo.className = "flex justify-start gap-5 items-center relative p-2 bg-[#1E1E1E] rounded-b-md"

    const imgLog = document.createElement("img");
    imgLog.className = "h-12 max-xl:h-10"
    imgLog.src = "../../../Logo-no-background-no-text.png";

    const divInfoInter = document.createElement("div");
    divInfoInter.className = "w-full h-full flex justify-between pr-2"

    const divInfoTemplate = document.createElement("div");
    divInfoTemplate.className = "flex flex-col";

    divInfoTemplate.innerHTML = `
        <h3 class="text-white text-xl font-bold max-xl:text-lg">${name}</h3>
        <h4 class="text-gray-300 text-lg max-xl:text-base">${author}</h4>
    `

    let contentLikes = document.createElement("span");

    if(likes !== null){
        contentLikes = document.createElement("div");
        contentLikes.className = "flex items-center gap-1 justify-between";

        contentLikes.innerHTML = `
            <h3 class="text-white text-sm font-bold max-xl:text-sm">${globals.formatNumber(likes)}</h3>
            <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="#ffffff" ><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" /></svg>
        `
    }

    divContent.appendChild(divTemplate);
    divContent.appendChild(divInfo);

    divTemplate.appendChild(divImage);
    divTemplate.appendChild(divSVG);

    divImage.appendChild(imgPreview);

    divInfo.appendChild(imgLog);
    divInfo.appendChild(divInfoInter);

    divInfoInter.appendChild(divInfoTemplate);
    divInfoInter.appendChild(contentLikes);
    
    parent.appendChild(divContent);

    reusable.showPreviewTemplate();

    if(depuring){
        front.utils.handleError("Project rendered successfully");
    }

    return divContent;
}

export async function renderMoreFavorites(){
    try {
        const data_response = await req.getDataUser(globals.getCookie("ID-USER"));
        let elementsUser;
        let elementsFiltered = [];

        if(data_response.state){
            elementsUser = [...data_response.data.message.templates, ...data_response.data.message.projects];
            const favorites = JSON.parse((await req.getFavorites(globals.getCookie("ID-USER"))).data.message[0].favorites);

            favorites.forEach((favorite) => {
                elementsUser.forEach((element) => {
                    if(element.project_id === favorite.id || element.template_id === favorite.id){
                        elementsFiltered.push(element);
                    }
                })
            });

            elementsUser = elementsFiltered;
        }

        if(elementsUser.length > 0){
            const content_more_favorites = document.querySelector("#content-more-favorites");
            content_more_favorites.innerHTML = "";

            elementsUser.forEach((element) => {
                if(element.project_id){
                    renderProject(element, content_more_favorites, false);
                }else{
                    renderTemplate(element, content_more_favorites, false);
                }
            });

            reusable.eventsListenerFavorites();
            front.utils.handleError("More Favorites rendered successfully");
            return content_more_favorites;
        }

        front.utils.handleError("More Favorites rendered successfully without any favorites");
        return content_more_favorites;
    }catch (err) {
        return err;
    }
}

export async function renderFavorites() {
    try {
        let favorites = await req.getFavorites(globals.getCookie("ID-USER"))
  
        if (!favorites.state) {
            front.utils.handleError(favorites)
            return
        }

        favorites = JSON.parse(favorites.data.message[0].favorites);

        const content_favorites = document.querySelector("#content-favorites");
        const svgIcons = {
            project: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="grey" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-brush"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M3 21v-4a4 4 0 1 1 4 4h-4"/><path d="M21 3a16 16 0 0 0 -12.8 10.2"/><path d="M21 3a16 16 0 0 1 -10.2 12.8"/><path d="M10.6 9a9 9 0 0 1 4.4 4.4"/></svg>`,
            template: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="grey" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-template"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 4m0 1a1 1 0 0 1 1 -1h14a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-14a1 1 0 0 1 -1 -1z"/><path d="M4 12m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z"/><path d="M14 12l6 0"/><path d="M14 16l6 0"/><path d="M14 20l6 0"/></svg>`
        };

        let templates = await req.getAllTemplates();

        if(!templates.state){
            front.utils.handleError(templates);
        }

        let projects = await req.getAllProjects(globals.getCookie("ID-USER"));

        if(!projects.state){
            front.utils.handleError(projects);
        }
        
        templates = templates.data.message;
        projects = projects.data.message;

        content_favorites.innerHTML = "";

        if (favorites.length === 0) {
            content_favorites.innerHTML = `<p class="text-white/30 font-normal">You don't have any favorites, add one!!</p>`;
        }
        
        const pShowMoreFavorites = document.querySelector("#showMoreFavorites");
        if(pShowMoreFavorites){
            pShowMoreFavorites.remove();
        }

        const length_favorites = favorites.length;
        const favorites_slice = favorites.slice(0, 4);

        if (favorites.length === 0) {
            front.utils.handleError("Favorites rendered successfully without any favorites");
            return content_favorites;
        }

        favorites_slice.forEach( async (favorite) => {
            let name;

            if(favorite.type == "template"){
                templates.forEach( (template) => {
                    if(template.template_id == favorite.id){
                        name = template.name;
                    }
                })
            }else{
                projects.forEach( (project) => {
                    if(project.project_id == favorite.id){
                        name = project.name
                    }
                })
            }

            const divFavorite = document.createElement('div');
            divFavorite.id = "useFavorite";
            divFavorite.className = "gap-3 p-2 rounded flex items-center cursor-pointer active:bg-stone-950";

            const typeDescription = document.createElement('i');
            typeDescription.id = "typeDescription";
            typeDescription.className = "group";
            
            typeDescription.innerHTML = favorite.type === "project" ? svgIcons.project : svgIcons.template;

            const favoriteName = document.createElement('p');
            favoriteName.textContent = favorite.name || name;

            divFavorite.appendChild(typeDescription);
            divFavorite.appendChild(favoriteName);

            content_favorites.appendChild(divFavorite);
        });
        
        if(length_favorites > 4){
            const pShowMoreFavorites = document.createElement('p');
            pShowMoreFavorites.id = "showMoreFavorites";
            pShowMoreFavorites.className = "hover:underline cursor-pointer font-normal text-sky-400";
            pShowMoreFavorites.textContent = `Ver más...`;
            content_favorites.parentNode.appendChild(pShowMoreFavorites);
        }

        const responseRenderMoreFavorites = await renderMoreFavorites();

        if(responseRenderMoreFavorites){
            front.utils.handleError("Favorites rendered successfully");
            return content_favorites;
        }
        
        reusable.eventsListenerFavorites();
        front.utils.handleError("Favorites rendered successfully");
        return content_favorites;
    } catch (error) {
        return error;
    }
}

export function deleteProject(projectId) {
    const projects = document.querySelectorAll(`#element-project[data-id="${projectId}"]`);
    
    projects.forEach(project => {
        project.parentNode.remove();
    });
    
    front.utils.handleError("Project deleted successfully");
}

export function renameProject(projectId, newName){
    const projects = document.querySelectorAll(`#element-project[data-id="${projectId}"]`);

    projects.forEach(project => {
        const name = project.parentNode.querySelector(".name-of-parcel");
        const input = project.parentNode.querySelector(".input-of-parcel");
    
        name.textContent = newName;
        input.value = newName;
    })
}