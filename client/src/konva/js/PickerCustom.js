import iro from '@jaames/iro';
import * as konva from './KonvaLogic';
import * as config from '../config';

var colorPicker = new iro.ColorPicker('#picker', {
    width: 120,
    color: "rgb(255, 0, 0)",
    handleRadius: 7,
    layout: [
        {
            component: iro.ui.Wheel,
        },
    ]
});

var colorInput = document.getElementById('colorInput');
var debounceTimeout;

colorInput.value = colorPicker.color.hexString;

colorPicker.on('color:change', function(color) {
    colorInput.value = color.hexString;
    setColorNode(color.hexString);
});

export function setColor(colorValue) {
    if (colorValue.startsWith("#")) {
        colorPicker.color.hexString = colorValue;
    } else if (colorValue.startsWith("rgb")) {
        colorPicker.color.rgbString = colorValue;
    } else {
        console.error("Formato de color inválido. Usa #hex o rgb.");
        return;
    }
    
    colorInput.value = colorPicker.color.hexString;
    setColorNode(colorPicker.color.hexString);
}

function setColorNode(colorValue){
    const node = config.getNodeSelected();

    if(!node) return;
    node.fill(colorValue);
    konva.layer.batchDraw();
}

colorInput.addEventListener('input', function(e) {
    var colorValue = e.target.value;

    clearTimeout(debounceTimeout);

    debounceTimeout = setTimeout(function() {
        setColor(colorValue);
    }, 400);
});

colorInput.addEventListener('blur', () => {
    setColor(colorInput.value);
})