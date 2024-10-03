import React, { useEffect } from 'react';
import useAppState from '../../hooks/useAppState';
import { Copy, Clipboard, Trash2, ChevronUp, ChevronDown, Lock} from 'lucide-react';
import * as konva from '../../../../konva/js/KonvaLogic.js';
import Konva from 'konva'
import * as GlobalFunctions from '../../../../konva/js/GlobalFunctions';
import * as websocket from '../../../../js/websocket/eventHandlers'

const ContextMenu = () => {
    const { nodeSelected, nodeSelectedUpdate } = useAppState();

    document.addEventListener("updateContextMenu", (e) => {
        nodeSelectedUpdate(e.detail.node);
    })

    const deleteNode = () => {
        const element = nodeSelected.parent instanceof Konva.Group ? nodeSelected.parent : nodeSelected;
        GlobalFunctions.deleteElement(element);
        websocket.deleteElementKonva({elementKonva: element});

        konva.tr.nodes([]);
        konva.layer.batchDraw();
    }



    return (
        <div id='contextMenu' className="bg-[#2e2e2e] border border-[rgba(255,255,255,.2)] rounded-lg shadow-lg p-1 w-48 hidden flex-col absolute top-28 left-28">
        <MenuItem icon={<Copy size={20} />} text="Duplicate" />
        <MenuItem icon={<Clipboard size={20} />} text="Paste" />
        <MenuItem eventHandle={deleteNode} icon={<Trash2 size={20} />} text="Delete" />
        <Divider />
        <MenuItem icon={<ChevronUp size={20} />} text="Front" />
        <MenuItem icon={<ChevronDown size={20} />} text="Back" />
        <Divider />
        <MenuItem icon={<Lock size={20} />} text="Lock" />
        </div>
    );
};

const MenuItem = ({ icon, text, eventHandle }) => (
  <button onClick={eventHandle} className="w-full flex items-center gap-x-2 p-2 text-sm text-[rgba(255,255,255,.8)] hover:bg-[#3a3a3a] rounded-md">
    {React.cloneElement(icon, { color: "currentColor" })}
    <span>{text}</span>
  </button>
);

const Divider = () => (
  <div className="my-1 border-t border-[rgba(255,255,255,.2)]"></div>
);

export default ContextMenu;