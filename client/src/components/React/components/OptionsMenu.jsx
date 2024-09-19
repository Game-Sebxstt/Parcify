import React, { useCallback, useEffect } from 'react';
import * as req from '../../../js/backend/requests.js'
import * as front from '../../../js/frontend/front.js';
import * as reusable from '../../../js/frontend/utilities/reusable.js';
import useAppState from '../hooks/useAppState.js';
import * as environment_utils from '../../../js/globals/environment-utils.js';

export default function OptionsMenu() {
    const { projects, ProjectsUpdate, FavoritesUpdate, favorites } = useAppState();

    const addFavorites = async () => {
      const optionsParcel = document.getElementById("options-parcel");
      const dataType = optionsParcel.getAttribute("data-type");
      const dataId = optionsParcel.getAttribute("data-id");
      const projectFind = projects.find(project => project.project_id == dataId);
      FavoritesUpdate([...favorites, projectFind]);
      environment_utils.addPreferences({ id: dataId, type: dataType });
      await req.favorite(environment_utils.getDataUser().users.user_id, { id_project: dataId, type: dataType });
    };

    const removeFavorites = async () => {
      const optionsParcel = document.getElementById("options-parcel");
      const dataId = optionsParcel.getAttribute("data-id");
      FavoritesUpdate(favorites.filter(favorite => favorite.project_id != dataId));
      environment_utils.removePreferences(dataId);
      await req.unfavorite(environment_utils.getDataUser().users.user_id, dataId);
    }

    const deleteProject = async () => {
      const elements_select = front.recourses.selectedElements;
      let id_list = [];

      if (elements_select.length > 1) {
          elements_select.forEach((element) => {
              id_list.push(element.querySelector("#element-project").getAttribute("data-id"));
          });

          const validation = await req.deleteListProjects(id_list);

          if (!validation.state || !validation) {
            front.utils.handleError(validation);
            return;
          }

          id_list.forEach(async (id) => {
            await req.unfavorite(environment_utils.getDataUser().users.user_id, id);
          })

          const projectsCloned = [...projects];
          const favoritesCloned = [...favorites];

          id_list.forEach((id) => {
              projectsCloned.splice(projectsCloned.findIndex(project => project.project_id == id), 1);
              favoritesCloned.splice(favoritesCloned.findIndex(favorite => favorite.project_id == id), 1);
          })

          environment_utils.setPreferences(favoritesCloned);
          FavoritesUpdate(favoritesCloned);
          ProjectsUpdate(projectsCloned);
      }else{
          const optionsParcel = document.getElementById("options-parcel");
          const dataId = optionsParcel.getAttribute("data-id");
          
          try {
              ProjectsUpdate(projects.filter(project => project.project_id != dataId));
              FavoritesUpdate(favorites.filter(favorite => favorite.project_id != dataId));
              environment_utils.removePreferences(dataId);
              await req.deleteProject(dataId);
          } catch (error) {
              console.error("Error deleting project:", error);
          }
      }
    };

    const duplicateProject = async () => {
      const elements_select = front.recourses.selectedElements;
      let id_list = [];

      if (elements_select.length > 1) {
          elements_select.forEach((element) => {
              id_list.push(element.querySelector("#element-project").getAttribute("data-id"));
          });

          const validation = await req.duplicateListProjects(id_list);

          if (!validation.state || !validation) {
            front.utils.handleError(validation);
            return;
          }

          const projectsCloned = [...projects];

          id_list.forEach((id) => {
              const project = projects.find(project => project.project_id == id);
              const projectCloned = { ...project, project_id: validation.data.message.project_id };
              projectsCloned.push(projectCloned);
          })

          ProjectsUpdate(projectsCloned);
      }else{
          const optionsParcel = document.getElementById("options-parcel");
          const dataId = optionsParcel.getAttribute("data-id");
          const project = projects.find(project => project.project_id == dataId);
          const validation = await req.duplicateProject(dataId);

          if (!validation.state || !validation) {
            front.utils.handleError(validation);
            return;
          }

          const projectCloned = { ...project, project_id: validation.data.message.project_id };
          ProjectsUpdate([...projects, projectCloned]);
      }
    }

    const renameProject = async () => {
      const projectId = document.querySelector("#options-parcel").getAttribute("data-id");
      const projectIdElement = document.querySelector("#options-parcel").getAttribute("data-id-element");
      const projectContents = document.querySelectorAll(".project");
      let isInit = true;
      
      let targetElement = null;
  
      projectContents.forEach((project) => {
        const element = project.querySelector(`#element-project[data-id="${projectId}"][data-id-element="${projectIdElement}"]`);      
        if (element) {
          targetElement = element.parentNode;
          return;
        }
      });
  
      if (!targetElement) {
        front.utils.handleError(`Could not find project with id ${projectId}`);
        return;
      }
  
      if(!targetElement.classList.contains("project")){
        front.utils.handleError("Could not find project with id ${projectId}");
        return;
      }
  
      const h3 = targetElement.querySelector('.name-of-parcel');
      const input = targetElement.querySelector('.input-of-parcel');
    
      h3.style.display = "none";
      input.style.display = "flex";
    
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    
      const saveChanges = async () => {
        if (!isInit) return;
        isInit = false;
        const validation = await req.renameProject(projectId, input.value);
    
        if (!validation.state) {
          front.utils.handleError(validation);
    
          h3.style.display = "flex";
          input.style.display = "none";
          input.value = h3.textContent;
    
          return;
        }
    
        h3.textContent = input.value;
        h3.style.display = "flex";
        input.style.display = "none";
    
        const project = projects.find(project => project.project_id == projectId);
        project.name = input.value;
        ProjectsUpdate([...projects]);
      };
    
      const handleBlur = async () => {
        saveChanges();
      };
    
      input.addEventListener("blur", handleBlur);
    }

    const redirectProject = () => {
        const optionsParcel = document.getElementById("options-parcel");
        const dataId = optionsParcel.getAttribute("data-id");
        reusable.redirectProjectAction(dataId);
    }

    const redirectProjectExternal = () => {
        const optionsParcel = document.getElementById("options-parcel");
        const dataId = optionsParcel.getAttribute("data-id");
        reusable.redirectProjectAction(dataId, true);
    }

    return (
        <div id="options-parcel" className="w-full max-w-[15rem] h-fit hidden fixed z-50">
            <ul className="bg-[#2b2929] p-1.5 shadow-lg shadow-[#181818] w-full flex flex-col justify-center item-start text-white animate-deployment">
                <li id="redirect" onClick={redirectProject} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default px-2 py-1 flex gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path d="M13 4h3a2 2 0 0 1 2 2v14" />
                        <path d="M2 20h3" />
                        <path d="M13 20h9" />
                        <path d="M10 12v.01" />
                        <path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" />
                    </svg>
                    <span>Abrir</span>
                </li>

                <li id="redirect-external" onClick={redirectProjectExternal} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default px-2 py-1 flex gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path d="M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6" />
                        <path d="M11 13l9 -9" />
                        <path d="M15 4h5v5" />
                    </svg>
                    <span>Abrir en otra pestaña</span>
                </li>

                <span className="separator-options w-full h-[1px] bg-[#383838] my-2"></span>

                <li id='duplicate-parcel' onClick={duplicateProject} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default px-2 py-1 flex gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" />
                        <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" />
                    </svg>
                    <span>Duplicar</span>
                </li>

                <li id='delete-parcel' onClick={deleteProject} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default px-2 py-1 flex gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path d="M4 7l16 0" />
                        <path d="M10 11l0 6" />
                        <path d="M14 11l0 6" />
                        <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
                        <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
                    </svg>
                    <span>Eliminar</span>
                </li>

                <li id="rename-parcel" onClick={renameProject} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default px-2 py-1 flex gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                    </svg>
                    <span>Cambiar nombre</span>
                </li>

                <span className="separator-options w-full h-[1px] bg-[#383838] my-2"></span>

                <li id="favorite" onClick={addFavorites} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default flex px-2 py-1 gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
                    </svg>
                    <span>Añadir a favoritos</span>
                </li>

                <li id="unfavorite" onClick={removeFavorites} className="hover:bg-[#1E90FF] w-full transition-all duration-150 ease-in cursor-default hidden px-2 py-1 gap-2" data-filter="test">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5">
                        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                        <path d="M3 3l18 18" />
                        <path d="M10.012 6.016l1.981 -4.014l3.086 6.253l6.9 1l-4.421 4.304m.012 4.01l.588 3.426l-6.158 -3.245l-6.172 3.245l1.179 -6.873l-5 -4.867l6.327 -.917" />
                    </svg>
                    <span>Quitar de Favoritos</span>
                </li>
            </ul>
        </div>
    );
}