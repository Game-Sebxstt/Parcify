import React,{useEffect} from 'react';
import useAppState from '../hooks/useAppState';
import * as environment_utils from '../../../js/globals/environment-utils';
import * as req from '../../../js/backend/requests';
import * as front from '../../../js/frontend/front';

const PreviewTemplate = () => {
    const { tittle, author, description, preview, template_id, ProjectsUpdate, projects, favorites, FavoritesUpdate, templates, TemplatesUpdate } = useAppState();
    let isLiked = false;

    useEffect(() => {
        const heartElement = document.querySelector("#heartTemplate");
        const favoriteElement = document.querySelector("#favoriteTemplate");
        const shareElement = document.querySelector("#shareTemplate");
        const userId = environment_utils.getDataUser().users.user_id;
        const templateId = document.querySelector("#previewTemplate").getAttribute("data-id");

        const template = environment_utils.getTemplate(templateId);

        if(!template){
            return;
        }

        const likes = JSON.parse(template.likes);
        const userFindLikes = likes.find(like => like.user_id == userId);

        if(userFindLikes){
            heartElement.style.fill = "#f46262";
            isLiked = true;
        }else{
            heartElement.style.fill = "none";
            isLiked = false;
        }

        const favorite = environment_utils.getPreference(templateId);

        if(favorite){
            favoriteElement.style.fill = "#f4d462";
        }else{
            favoriteElement.style.fill = "none";
        }

    },[tittle])

    const createTemplate = async () => {
        const templateId = document.querySelector("#previewTemplate").getAttribute("data-id");
        const userId = environment_utils.getDataUser().users.user_id;
        const validation = await req.createProject(userId, "Untitled", templateId);
    
        if (!validation.state || !validation) {
            front.utils.handleError(validation);
            return;
        }
        
        const props = {
            name: "Untitled",
            project_id: validation.data.message.project_id,
            preview: validation.data.message.preview,
            stage: validation.data.message.stage,
            collaborators: validation.data.message.collaborators,
            last_modified: validation.data.message.last_modified,
        }

        ProjectsUpdate([...projects, props]);
        document.querySelector("#previewTemplate").style.display = "none";
    };

    const closeTemplate = () => {
        document.querySelector("#previewTemplate").style.display = "none";
    }

    const heartTemplate = async () => {
        const heartElement = document.querySelector("#heartTemplate");
        const fill = heartElement.style.fill;
        const userId = environment_utils.getDataUser().users.user_id;
        const templateId = document.querySelector("#previewTemplate").getAttribute("data-id");

        if (fill === "none" || fill === "") {
            heartElement.style.fill = "#f46262";
            const petition = await req.likeTemplate(templateId, userId)
      
            if (!petition.state) {
                front.utils.handleError(petition);
                return;
            }

            const template = environment_utils.getTemplate(templateId);
            template.likes = JSON.stringify(petition.data.message);
            environment_utils.setTemplate(templateId, template);
            const templatesCloned = [...templates];
            const excludeTemplate = templatesCloned.find(template => template.template_id == templateId);
            excludeTemplate.likes = JSON.stringify(petition.data.message);
            TemplatesUpdate(templatesCloned);
            front.utils.handleError("Template liked");
        } else {
            heartElement.style.fill = "none";
            const petition = await req.dislikeTemplate(templateId, userId)

            if (!petition.state) {
                front.utils.handleError(petition);
                return;
            }

            const template = environment_utils.getTemplate(templateId);
            template.likes = JSON.stringify(petition.data.message);
            environment_utils.setTemplate(templateId, template);
            const templatesCloned = [...templates];
            const excludeTemplate = templatesCloned.find(template => template.template_id == templateId);
            excludeTemplate.likes = JSON.stringify(petition.data.message);
            TemplatesUpdate(templatesCloned);

            front.utils.handleError("Template disliked");
        }
    }

    const favoriteTemplate = async () => {
        const favoriteElement = document.querySelector("#favoriteTemplate");
        const fill = favoriteElement.style.fill;
        const userId = environment_utils.getDataUser().users.user_id;
        const templateId = document.querySelector("#previewTemplate").getAttribute("data-id");

        const data = {
            id_project: templateId,
            type: "template",
        }

        if (fill === "none" || fill === "") {
            favoriteElement.style.fill = "#f4d462";
            const petition = await req.favorite(userId, data)
            environment_utils.addPreferences({id: data.id_project, type: data.type})
            FavoritesUpdate([...favorites, environment_utils.getTemplate(data.id_project)]);
      
            if (!petition.state) {
                front.utils.handleError(petition);
                return;
            }

            front.utils.handleError("Template added to favorites");
        } else {
            favoriteElement.style.fill = "none";
            const petition = await req.unfavorite(userId, data.id_project)
            environment_utils.removePreferences(data.id_project);
            FavoritesUpdate(favorites.filter(favorite => favorite && favorite.template_id != data.id_project));

            if (!petition.state) {
                front.utils.handleError(petition);
                return;
            }

            front.utils.handleError("Template removed from favorites");
        }
    }

    const shareTemplate = () => {
        document.querySelector("#shareTemplate").style.fill = "white"
        const dataId = document.querySelector("#previewTemplate").getAttribute("data-id");
        const urlCopy = `${window.location.origin}/?template_id=${dataId}`;
        navigator.clipboard.writeText(urlCopy);
    
        front.utils.handleError("Link copied to clipboard");
    }

    return (
        <section id="previewTemplate" data-id={template_id} className="fixed w-full h-full z-50 hidden justify-center items-center bg-black/80">
            <section className="w-[50rem] h-[26rem] bg-[#2c2c2c] rounded-md p-3 flex flex-col gap-2 animate-deployment">
                <header className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <img src="/Logo-no-background-no-text.png" className="h-10" alt="Logo"/>
                        <h3 className="text-xl font-bold text-white">Parcify</h3>
                    </div>
                    <button id="close-button" onClick={closeTemplate} type="button" className="text-gray-400 hover:bg-gray-200 hover:text-gray-900 rounded-lg w-8 h-8 inline-flex justify-center items-center">
                        <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"/>
                        </svg>
                    </button>
                </header>

                <hr className="border-blue-500" />

                <main className="h-full flex justify-between gap-2">
                    <section className="h-full/2 w-[55%] bg-gray-200 relative">
                        <img id="infoPreview" className="absolute w-full h-full object-cover" src={preview} alt="Preview" />
                    </section>

                    <section className="flex flex-col gap-2 justify-between w-[50%]">
                        <article className="flex flex-col justify-start gap-2 flex-1">
                            <div className="flex flex-col gap-1">
                                <h1 id="tittlePreview" className="text-white text-4xl font-bold">{tittle}</h1>
                                <p id="authorPreview" className="text-white text-lg font-semibold">By {author}</p>
                                <p id="infoDescription" className="text-gray-400 text-justify">{description}</p>
                            </div>
                        </article>

                        <article className="flex items-center justify-between pl-2">
                            {tittle !== "Plantilla Vacia" && (
                                <nav id='options-template' className="flex items-center gap-4">
                                    <svg id="heartTemplate" onClick={heartTemplate} className="cursor-pointer ease duration-150 transition-all h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f46262" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                        <path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" />
                                    </svg>
                                    <svg id="favoriteTemplate" onClick={favoriteTemplate} className="cursor-pointer ease duration-150 transition-all h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#f4d462" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                        <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
                                    </svg>
                                    <svg id="shareTemplate" onClick={shareTemplate} className="cursor-pointer ease duration-150 transition-all h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
                                        <path d="M13 4v4c-6.575 1.028 -9.02 6.788 -10 12c-.037 .206 5.384 -5.962 10 -6v4l8 -7l-8 -7z" />
                                    </svg>
                                </nav>
                            )}
                            <button id="createTemplate" onClick={createTemplate} className="bg-blue-500 py-2 px-4 rounded">Create</button>
                        </article>
                    </section>
                </main>
            </section>
        </section>
    );
};

export default PreviewTemplate;