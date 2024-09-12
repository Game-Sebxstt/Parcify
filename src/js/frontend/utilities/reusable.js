import * as globals from '../utilities/globals'
import * as templates from '../utilities/templates'
import * as req from "../../backend/requests";
import * as front from '../front'

// Options Projects

async function actionContextMenu(e, item){
    e.preventDefault();
    front.utils.changeStateWheelWindow(true);
    const elements_select = front.recourses.selectedElements;

    const dataId = item.getAttribute("data-id");
    const dataIdElement = item.getAttribute("data-id-element");
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
    optionsParcel.setAttribute("data-id-element", dataIdElement)
    optionsParcel.style.display = "flex";
    optionsParcel.style.top = `${e.clientY}px`;
    optionsParcel.style.left = `${e.clientX}px`;

    if(document.querySelector("#number-items")){
      document.querySelectorAll("#number-items").forEach(item => item.remove());
    }

    if(elements_select.length > 1){
      optionsParcel.querySelector("#redirect").style.display = "none";
      optionsParcel.querySelector("#redirect-external").style.display = "none";
      optionsParcel.querySelector("#rename-parcel").style.display = "none";
      optionsParcel.querySelector("#favorite").style.display = "none";
      optionsParcel.querySelector("#unfavorite").style.display = "none";
      optionsParcel.querySelectorAll(".separator-options").forEach(item => {
        item.style.display = "none";
      })

      const number_items = document.createElement("span");
      number_items.id = "number-items";
      number_items.className = "absolute right-5 text-white/80 font-light";
      number_items.textContent = elements_select.length;
      
      optionsParcel.querySelector("#duplicate-parcel").appendChild(number_items);
      optionsParcel.querySelector("#delete-parcel").appendChild(number_items.cloneNode(true));
    }else{
      optionsParcel.querySelector("#redirect").style.display = "flex";
      optionsParcel.querySelector("#redirect-external").style.display = "flex";
      optionsParcel.querySelector("#rename-parcel").style.display = "flex";
      optionsParcel.querySelector("#favorite").style.display = "flex";
      optionsParcel.querySelector("#unfavorite").style.display = "flex";
      optionsParcel.querySelectorAll(".separator-options").forEach(span => {
        span.style.display = "flex";
      })
    }

    const optionsParcelRect = optionsParcel.getBoundingClientRect();
    optionsParcel.style.left = optionsParcelRect.x + optionsParcelRect.width > window.innerWidth ? `${optionsParcelRect.x - optionsParcelRect.width}px` : `${optionsParcelRect.x}px`;
    optionsParcel.style.top = optionsParcelRect.y + optionsParcelRect.height > window.innerHeight ? `${optionsParcelRect.y - optionsParcelRect.height}px` : `${optionsParcelRect.y}px`;

    document.addEventListener("click", (e) => {
      if(e.target.id === "more-options-filter") return;

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
}

function eventsHandlerProjects(){
  document.querySelectorAll(".project").forEach(item => {
    item.addEventListener("click", async (e) => {
        console.log(front.recourses.selectedElements)
        const element = e.currentTarget;
        const index = Array.from(document.querySelectorAll(".project")).indexOf(element);

        if (front.recourses.isSelectionCtrl) {
            if (front.recourses.selectedElements.includes(element)) {
                front.utils.isDeselected(element);
            } else {
                front.utils.isSelected(element);
            }
        } else if (front.recourses.isSelectionShift) {
            if (front.recourses.lastIndex === null) {
                front.recourses.lastIndex = index;
                front.utils.isSelected(element);
            } else {
                const [min, max] = [Math.min(front.recourses.lastIndex, index), Math.max(front.recourses.lastIndex, index)];
                document.querySelectorAll(".project").forEach((item, i) => {
                    if (i >= min && i <= max) {
                        front.utils.isSelected(item);
                    }
                });
            }
        } else {
            front.utils.clear();
            front.utils.isSelected(element);
            front.recourses.lastIndex = index;
        }

        document.addEventListener("click", (e) => {
            if (e.target.id === "selectionIdentifier" || e.target.closest(".project")) return;
            front.utils.clear();
        });

        document.addEventListener("keydown", (e) => {
            if (e.keyCode === 27) {
                front.utils.clear();
            }
        })
    });
  });
}

function redirectProject(){
    document.querySelectorAll("#element-project").forEach((item) => {
        item.addEventListener("dblclick", () => {
          const projectId = item.getAttribute("data-id");
          redirectProjectAction(projectId);
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

function renameProjets(){
  document.querySelector("#rename-parcel")?.addEventListener("click", async () => {
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
    
        templates.renameProject(projectId, input.value);
    
        const renderResponse = await templates.renderFavorites();
    
        if (!renderResponse) {
          front.utils.handleError(renderResponse);
          return;
        }
      };
    
      const cancelChanges = () => {
        h3.style.display = "flex";
        input.style.display = "none";
        input.value = h3.textContent;
      };
    
      const handleBlur = async () => {
        saveChanges();
      };
    
      input.addEventListener("blur", handleBlur);
  });
}

// Options favorites
function showMoreFavorites(){
  document.querySelector("#showMoreFavorites")?.addEventListener("click", async () => {
    window.getComputedStyle(document.querySelector("#moreFavorites")).display == "none" ? document.querySelector("#moreFavorites").style.display = "flex" : document.querySelector("#moreFavorites").style.display = "none"
  });
}

// Functions Export
export function changeTheme(theme){
    //Update gui with theme selected
}

export function showPreviewTemplate(){
    document.querySelectorAll(".create-template").forEach((item) => {
        item.addEventListener("click", (e) => {
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

export function redirectProjectAction(projectId, external = false){
  const collaborators = {
  user_id: globals.getCookie("ID-USER"),
  last_access: new Date(),
  }

  req.saveCollaborators(projectId, collaborators).then((data) => {
    if (!data.state) {
        front.utils.handleError(data);
        return;
    }

    globals.startSession(projectId);

    if(external){
      window.open(`/konva?id=${projectId}`, '_blank');
      return
    }

    window.location.href = `/konva?id=${projectId}`;
  })
}

// Events Listeners
export function eventsListenerProjects(){
    showContextMenu(); // Show context menu
    redirectProject(); // Redirect to project
    searchProjects(); // Search projects
    renameProjets(); // Rename projects
    eventsHandlerProjects(); // Events handler projects
}

export function eventsListenerFavorites(){
    showMoreFavorites();
}

export function eventsListenerMoreFavorites(){
    showMoreFavorites();
}