import React, { useEffect, useRef, useState } from 'react';
import iro from '@jaames/iro';
import Konva from 'konva';
import * as konva from '../../../../konva/js/KonvaLogic.js';
import * as config from '../../../../konva/config.ts';

const PickCustom = ({ onColorChange, colorProperty }) => {
    const pickerRef = useRef(null);
    const inputRef = useRef(null);
    const [color, setColor] = useState("#ff0000");
    let colorPicker

    useEffect(() => {
        if(colorPicker) return;

        colorPicker = new iro.ColorPicker(pickerRef.current, {
            width: 120,
            color: "rgb(255, 0, 0)",
            handleRadius: 7,
            layout: [
                {
                    component: iro.ui.Wheel,
                },
            ]
        });

        colorPicker.on('color:change', (color) => {
            setColor(color.hexString);
            setColorNode(color.hexString);
        });
    }, []);

    const setColorValue = (colorValue) => {
        if (colorValue.startsWith("#") || colorValue.startsWith("rgb")) {
            setColor(colorValue);
            setColorNode(colorValue);
        } else {
            console.error("Formato de color inválido. Usa #hex o rgb.");
        }
    };

    const setColorNode = (colorValue) => {
        const node = config.getNodeSelected();

        if (!node) return;
        
        if (colorProperty === 'textColor') {
            node.parent.children.find(item => item instanceof Konva.Text).fill(colorValue);
        } else {
            node.fill(colorValue);
        }
        
        konva.layer.batchDraw();
        onColorChange(colorValue);
    };

    const handleInputChange = (e) => {
        const colorValue = e.target.value;
        setColor(colorValue);
    };

    const handleInputBlur = () => {
        setColorValue(color);
    };

    return (
        <div className="flex flex-col gap-y-2 items-center justify-center">
            <div id="picker" ref={pickerRef}></div>
            <input
                type="text"
                id="colorInput"
                ref={inputRef}
                placeholder="Enter color (hex or rgb)"
                className="w-fit p-2 text-center bg-gray-100 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-md text-gray-700"
                value={color}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
            />
        </div>
    );
};

export default PickCustom;