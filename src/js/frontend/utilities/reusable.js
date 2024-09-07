import * as globals from '../utilities/globals'
import * as req from "../../backend/requests";
import * as key from "../utilities/keyEvents"
import * as front from '../front'

async function actionContextMenu(e, item){
    e.preventDefault();
    front.utils.changeStateWheelWindow(true);

    const dataId = item.getAttribute("data-id");
    const dataType = "project";
    const optionsParcel = document.querySelector("#options-parcel");
    const isFavoriteElement = await globals.isFavorite(Number(dataId))

    if(!optionsParcel){
    front.utils.handleError(`Could not find options parcel for ${item.getAttribute("data-id")}`);
    return;
    }

    if(isFavoriteElement){
    document.querySelector("#favorite").style.display = "none";
    document.querySelector("#unfavorite").style.display = "flex";
    }else{
    document.querySelector("#favorite").style.display = "flex";
    document.querySelector("#unfavorite").style.display = "none";
    }

    optionsParcel.setAttribute("data-id", dataId);
    optionsParcel.setAttribute("data-type", dataType);
    optionsParcel.style.display = "flex";
    optionsParcel.style.top = `${e.clientY}px`;
    optionsParcel.style.left = `${e.clientX}px`;

    document.addEventListener("click", () => {
    optionsParcel.style.display = "none";
    front.utils.changeStateWheelWindow(false);
    });
}

function showContextMenu(){
    document.querySelectorAll("#element-project").forEach((item) => {
        item.addEventListener("contextmenu", async (e) => {
            actionContextMenu(e, item);
        });
    });

    document.querySelectorAll("#selectionIdentifier").forEach((item) => {
        item.addEventListener("contextmenu", async (e) => {
            actionContextMenu(e, item);
        });
    });
}

function redirectProject(){
    document.querySelectorAll("#element-project").forEach((item) => {
        item.addEventListener("dblclick", () => {
            if(key.recourses.isSelection) return;
            
            const projectId = item.getAttribute("data-id");
            const collaborators = {
            user_id: globals.getCookie("ID-USER"),
            last_access: new Date(),
            }

            console.log("Project", projectId, collaborators);

            req.saveCollaborators(projectId, collaborators).then((data) => {
            if (!data.state) {
                front.utils.handleError(data);
                return;
            }

            globals.startSession(projectId);

            window.location.href = `/konva?id=${projectId}`;
            })
        });
    });
}

function selectProject(){
    document.querySelectorAll("#element-project").forEach((item) => {
        item.addEventListener("click", () => {
            if(!key.recourses.isSelection) return;

            // key.utils.clear();
            // key.utils.isSelected(item.parentNode);
        });
    });
}

function searchProjects(){
    document.querySelectorAll("#searchbar").forEach((item) => {
        item?.addEventListener("input", (e) => {
          const searchTerm = item.value.toLowerCase();
          const typeElement = item.getAttribute("data-article");
          const elementsToFilter = document.querySelectorAll(`.${typeElement}`) || document.querySelectorAll(`#${typeElement}`);
    
          elementsToFilter.forEach((element) => {
            const name = element.getAttribute("data-name")?.toLowerCase();
            front.utils.toggleHidden(element, !name.includes(searchTerm));
          });
        });
    });
}

export function changeTheme(theme){
    //Update gui with theme selected
}

export function eventsListenerProjects(){
    showContextMenu(); // Show context menu
    redirectProject(); // Redirect to project
    selectProject(); // Select project
    searchProjects(); // Search projects
}

export function showPreviewTemplate(){
    document.querySelectorAll(".create-template").forEach((item) => {
        item.addEventListener("click", (e) => {
        console.log("click")
          const dataId = item.getAttribute("data-id");
          const dataName = item.getAttribute("data-name");
          const dataAuthor = item.getAttribute("data-author");
          const dataPreview = item.getAttribute("data-preview");
          const dataDescription = item.getAttribute("data-description");
    
          front.utils.showPreviewTemplate({
            dataId,
            dataName,
            dataAuthor,
            dataPreview,
            dataDescription
          })
        });
    });
}