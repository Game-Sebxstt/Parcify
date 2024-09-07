//! Eventos del teclado en Parcify

/**
 *  ? Teclas
 *  * Shift
 *  * Ctrl
 *  * Delete
 *  * Supr
 */

// elementos del DOM
const elements = {
    projects: document.querySelectorAll(".project"),
};

export let recourses = {
    selectedElements: [],
    lastIndex: null,
    isSelection: false,
}

export const utils = {
    isSelected:(element) => {
        if (!recourses.selectedElements.includes(element)) {
            const selectionIdentifier = element.querySelector("#selectionIdentifier");
            selectionIdentifier.style.display = "flex";
            recourses.selectedElements.push(element);
        }
    },
    isDeselected:(element) => {
        const selectionIdentifier = element.querySelector("#selectionIdentifier");
        selectionIdentifier.style.display = "none";
        recourses.selectedElements = recourses.selectedElements.filter(selected => selected !== element);
    },
    clear:() => {
        elements.projects.forEach(item => {utils.isDeselected(item)});
        recourses.selectedElements = [];
    },
};

export async function shiftSelect() {
    elements.projects.forEach((item, index) => {
        item.addEventListener("click", (keyPress) => {
            if (!(recourses.lastIndex != null)) {
                utils.clear();
                utils.isSelected(item);
                recourses.lastIndex = index;
                return;
            }

            const min = Math.min(recourses.lastIndex, index);
            const max = Math.max(recourses.lastIndex, index);

            utils.clear();

            for (let i = min; i <= max; i++) {
                utils.isSelected(elements.projects[i]);
            }
            
            document.addEventListener("click", (e) => {
                if(e.target.id === "element-project" || e.target.id === "selectionIdentifier") return;
                utils.clear();
                recourses.lastIndex = null;
            })
        });
    });
}

function actionElement(item, index, keyPress){
    if(!(keyPress.ctrlKey || keyPress.metaKey)){
        utils.clear();
        utils.isSelected(item);
        recourses.lastIndex = index;
        return;
    }
}

export async function crtlSelect() {
    elements.projects.forEach((item, index) => {
        item.addEventListener("click", (keyPress) => {
            if (!recourses.selectedElements.includes(item)) {
                utils.isSelected(item);
            } else {
                utils.isDeselected(item);
            }

            recourses.lastIndex = index;
            actionElement(item, index, keyPress);
            
            document.addEventListener("click", (e) => {
                if(e.target.id === "element-project" || e.target.id === "selectionIdentifier") return;
                utils.clear();
                recourses.lastIndex = null;
            })
        });
    });
}