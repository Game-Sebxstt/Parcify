import * as globals from '../utilities/globals'
import * as req from "../../backend/requests";
import * as front from '../front'

export async function actionContextMenu(e, item){
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

    optionsParcel.setAttribute("data-id", dataId);
    optionsParcel.setAttribute("data-type", dataType);
    optionsParcel.setAttribute("data-id-element", dataIdElement)
    optionsParcel.style.display = "flex";
    optionsParcel.style.top = `${e.clientY}px`;
    optionsParcel.style.left = `${e.clientX}px`;

    if(document.querySelector("#number-items")){
      document.querySelectorAll("#number-items").forEach(item => item.remove());
    }

    function validateIsFavorite(){
      if(isFavoriteElement){
        document.querySelector("#favorite").style.display = "none";
        document.querySelector("#unfavorite").style.display = "flex";
      }else{
        document.querySelector("#favorite").style.display = "flex";
        document.querySelector("#unfavorite").style.display = "none";
      }
    }

    if(elements_select.length > 1){
      optionsParcel.querySelector("#redirect").style.display = "none";
      optionsParcel.querySelector("#redirect-external").style.display = "none";
      optionsParcel.querySelector("#rename-parcel").style.display = "none";

      if(isFavoriteElement){
        document.querySelector("#favorite").style.display = "none";
        document.querySelector("#unfavorite").style.display = "flex";
      }else{
        document.querySelector("#favorite").style.display = "flex";
        document.querySelector("#unfavorite").style.display = "none";
      }

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

      validateIsFavorite();

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

searchProjects();