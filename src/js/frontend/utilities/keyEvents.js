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
    projects: document.querySelectorAll("#project"),
};

let recourses = {
    selectedElements: [],
    lastIndex: null,
}

const utils = {
    isSelected:(element) => {
        if (!recourses.selectedElements.includes(element)) {
            // Selecciona solo el `selectionIdentifier` dentro del proyecto clicado
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

// //TODO - Evento de seleccion
// export async function selectProject() {
//     elements.projects.forEach((item, index) => {
//         item.addEventListener("click", (keyPress) => {
//             if (keyPress.shiftKey && lastIndex != null) {
//                 const min = Math.min(lastIndex, index);
//                 const max = Math.max(lastIndex, index);
//                 clear();
//                 for (let i = min; i <= max; i++) {
//                     isSelected(elements.projects[i]);
//                 }
//             } else if(keyPress.ctrlKey || keyPress.metaKey){
//                 if (!selectedElements.includes(item)) {
//                     isSelected(item);
//                 } else {
//                     isDeselected(item);
//                 }
//                 lastIndex = index;
//             }else{
//                 clear();
//                 isSelected(item);
//                 lastIndex = index;
//             }
//         });
//     });

//     const isSelected = (element) => {
//         if (!selectedElements.includes(element)) {
//             // Selecciona solo el `selectionIdentifier` dentro del proyecto clicado
//             const selectionIdentifier = element.querySelector("#selectionIdentifier");
//             if (selectionIdentifier) {
//                 selectionIdentifier.style.display = "flex";
//             }
//             selectedElements.push(element);
//         }
//     };

//     const isDeselected = (element) => {
//         const selectionIdentifier = element.querySelector("#selectionIdentifier");
//         if (selectionIdentifier) {
//             selectionIdentifier.style.display = "none";
//         }
//         selectedElements = selectedElements.filter(selected => selected !== element);
//     };

//     const clear = () => {
//         elements.projects.forEach(item => {
//             isDeselected(item);
//         });
//         selectedElements = [];
//     };

// }

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
        });
    });
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
            
            if(!(keyPress.ctrlKey || keyPress.metaKey)){
                utils.clear();
                utils.isSelected(item);
                recourses.lastIndex = index;
                return;
            }
        });
    });
}