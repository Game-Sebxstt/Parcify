import Konva from 'konva'
import * as konva from '../../konva/js/KonvaLogic';
import * as GlobalFunctions from '../../konva/js/GlobalFunctions';
import * as Render from '../../konva/js/Render';
import * as chat from '../frontend/utilities/chat';
import * as utils from '../globals/environment-utils';
import * as globals from '../frontend/utilities/globals'
import * as req from '../backend/requests'

//Disabled
export function groupElements(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const nodesList = data.elements.map(item => {
            const element = JSON.parse(item);
            return konva.stage.findOne(`#${element.attrs.id_unique}`);
        }).filter(Boolean);

        konva.groupElements(nodesList, data.generatedId, data.user_id);
    }
}

//Disabled
export function ungroupElements(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        // const groupKonva = JSON.parse(data.groupKonva[0]);
        // konva.ungroupElements(groupKonva);
    }
}

export function createElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.createElementKonva(elementKonva);
    }
}

export function deleteElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        let elementKonva

        if(typeof data.elementKonva == "string"){
            elementKonva = JSON.parse(data.elementKonva);
        }else{
            elementKonva = data.elementKonva
        }

        GlobalFunctions.deleteElementKonva(elementKonva);
    }
}

export function moveUpElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.moveUpElementKonva(elementKonva);
    }
}

export function moveDownElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        GlobalFunctions.moveDownElementKonva(elementKonva);
    }
}

export function selectElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const elementKonva = JSON.parse(data.elementKonva);
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementByIdUnique(layerKonva, elementKonva.attrs.id_unique);
        if (elementKonvaOfLayer) {
            const collaborator = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
            GlobalFunctions.setBorderElement(elementKonvaOfLayer, collaborator);
        }
    }
}

export function deselectElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.removeBorderElement();
    }
}

export function changeElementKonva(data) {
    const node = JSON.parse(data.data.data.node);
    const layerKonva = konva.stage.findOne('#layer');
    const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, node.attrs.id_unique);
    if (elementKonvaOfLayer) {
        GlobalFunctions.setAttrOfAction(data.data.data.change, data.data.data.type, false, elementKonvaOfLayer);
    }
}

export function updatePosElementKonva(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        const dataNode = data.data;
        const layerKonva = konva.stage.findOne('#layer');
        const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, dataNode.data.id_unique);
        const isGroup = elementKonvaOfLayer instanceof Konva.Group;
        if (elementKonvaOfLayer) {
            const idRect = isGroup ? elementKonvaOfLayer.children.find(item => item instanceof Konva.Rect).getAttr("id_unique") : elementKonvaOfLayer.getAttr("id_unique");
            const arrows = konva.layer.find(".arrow")
            const arrowOfRect = arrows.filter(item => (item.getAttr("anchorIdA") == idRect || item.getAttr("anchorIdB") == idRect))

            if(arrowOfRect){
                arrowOfRect.forEach(item => {
                    item.updateArrow();
                })
            }

            GlobalFunctions.updateAttrsElement(elementKonvaOfLayer, dataNode);
            GlobalFunctions.updateCursorCollaborator(data.data.data.posCursor, data.data.user_id);
        }
    }
}

export function enterCollaborator(data) {
    const collaboratorFind = utils.getCollaboratorOfProject(data.collaborator.project_id, data.user_id);
    if (!collaboratorFind) {
        req.saveCollaborators(data.collaborator.project_id, { user_id: data.user_id, state: true });
    }
    
    Render.updateCollaborators(data.collaborator);
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.createCursorCollaborator(data.collaborator);
        GlobalFunctions.createSelectionRectangleCollaborator(data.collaborator);
    }
}

export async function exitCollaborator(data) {
    if(!data.data || !data.data.collaborator || !data.data.collaborator.project_id) {
        console.error('Collaborator data is missing:', data);
        return;
    }

    const data_change = {
        user_id: data.data.id,
        state: false,
    }

    const collaboratorFind = utils.getCollaboratorOfProject(data.data.collaborator.project_id, data.user_id);

    if(!collaboratorFind){
        await req.saveCollaborators(data.data.collaborator.project_id, data_change)
    }
    
    const project_database = utils.getProject(data.data.collaborator.project_id)
    const project_collaborators = JSON.parse((await req.getProject(data.data.collaborator.project_id)).data.message.collaborators);
    project_collaborators.forEach(item => {
        if(item.state) return;

        Render.removeCollaborator(item)
    })

    GlobalFunctions.removeCursorCollaborator(data.data.id);
}

export function mouseCursor(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        GlobalFunctions.updateCursorCollaborator(data.position, data.user_id);
    }
}

export function message(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.createMessageExternal(data.data);
    }
}

export function createTextInElementKonva(data){
    const node = JSON.parse(data.data.element);
    const attrsText = data.data.attrs;
    const layerKonva = konva.stage.findOne('#layer');
    const elementKonvaOfLayer = GlobalFunctions.findElementRecursively(layerKonva, node.attrs.id_unique);
    const isSelected = data.user_id == globals.getCookie("ID-USER");

    if (elementKonvaOfLayer) {
        GlobalFunctions.createTextInShape(attrsText, elementKonvaOfLayer, isSelected);
    }
}

export function startEditTextInElementKonva(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;

    const textarea_config = data.data.textarea_config
    const nodeElementDrag = JSON.parse(textarea_config.elementDrag);
    const nodeTextNode = JSON.parse(textarea_config.textNode);
    const layerKonva = konva.stage.findOne('#layer');
    const elementDrag = GlobalFunctions.findElementRecursively(layerKonva, nodeElementDrag.attrs.id_unique);
    const textNode = GlobalFunctions.findElementRecursively(layerKonva, nodeTextNode.attrs.id_unique);
    textarea_config.elementDrag = elementDrag;
    textarea_config.textNode = textNode

    var textPosition = elementDrag.absolutePosition();
    var stageBox = konva.stage.container().getBoundingClientRect();

    var areaPosition = {
        x: stageBox.left + textPosition.x,
        y: stageBox.top + textPosition.y,
    };

    if(textNode){
        textNode.hide();
    }
    
    konva.createTextArea(
        textarea_config.textAlign, areaPosition, 
        textarea_config.elementDrag, textarea_config.textNode, 
        textarea_config.value, textarea_config.textarea_edit, 
        data.data.collaborator
    )
}

export function createHighlightText(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;

    konva.createHighlight(data.data)
}

export function removeHighlightText(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;

    konva.removeHighlight(data.data)
}

export function updateShapeText(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;

    if(data.data.updateCaret.state){
        konva.updateCustomCaret(data.data.updateCaret)
    }

    if(data.data.updateText.state){
        konva.textAreaUpdate(data.data.updateText)
    }
}

export function startSelectionRectangle(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;
    GlobalFunctions.createSelectionRectangleCollaborator(data.data)
}

export function updateSelectionRectangle(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;
    GlobalFunctions.updateSelectionRectangleCollaborator(data.data, data.user_id)
}

export function stopSelectionRectangle(data){
    if(data.user_id == globals.getCookie("ID-USER")) return;
    GlobalFunctions.removeSelectionRectangleCollaborator(data.user_id)
}

export function typing(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.createTypingExternal(data.data.data);
    }
}

export function stopTyping(data) {
    if (data.user_id !== globals.getCookie("ID-USER")) {
        chat.removeTypingExternal(data.data.data);
    }
}