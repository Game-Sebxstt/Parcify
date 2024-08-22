import Konva from 'konva';

export class PickerCustom {
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private layerUtilities: Konva.Layer;
    private colorBlock: Konva.Rect;
    private colorStrip: Konva.Rect;
    private selectedColor: string;
    private colorPreview: Konva.Rect;
    private picker: Konva.Circle;
    private drag: boolean;
    private dragPicker: boolean;

    constructor(stage: Konva.Stage, layer: Konva.Layer, layerUtilities: Konva.Layer) {
        this.stage = stage;
        this.layer = layer;
        this.layerUtilities = layerUtilities;
        this.drag = false;
        this.dragPicker = false;
        this.selectedColor = 'rgba(255,255,0,1)';

        this.initPicker();
    }

    private initPicker() {
        const blockWidth = 300;
        const blockHeight = 150;
        const stripWidth = 50;

        this.colorStrip = new Konva.Rect({
            x: blockWidth + 10,
            y: 0,
            width: stripWidth,
            height: blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: blockHeight },
            fillLinearGradientColorStops: [
                0, 'rgba(255, 0, 0, 1)',
                0.17, 'rgba(255, 255, 0, 1)',
                0.34, 'rgba(0, 255, 0, 1)',
                0.51, 'rgba(0, 255, 255, 1)',
                0.68, 'rgba(0, 0, 255, 1)',
                0.85, 'rgba(255, 0, 255, 1)',
                1, 'rgba(255, 0, 0, 1)'
            ],
            block: true,
        });

        this.layerUtilities.add(this.colorStrip);

        this.colorBlock = new Konva.Rect({
            x: 0,
            y: 0,
            width: blockWidth,
            height: blockHeight,
            fill: 'rgba(255,255,0,1)',
            block: true,
            pick: true,
        });

        this.colorPreview = new Konva.Rect({
            x: blockWidth + 10 + stripWidth + 10,
            y: 0,
            width: 50,
            height: 50,
            fill: 'rgba(255,255,0,1)',
            block: true,
        });

        this.layerUtilities.add(this.colorBlock);
        this.layerUtilities.add(this.colorPreview);
        this.fillGradient();

        this.colorStrip.on('mousedown', (e) => this.startDrag(e));
        this.colorStrip.on('mouseup', () => this.stopDrag());
        this.colorStrip.on('mousemove', (e) => this.onDrag(e));
        this.stage.on('mousedown', (e) => this.startPickHue(e));
        this.stage.on('mousemove', (e) => this.pickHue(e, this.stage));
        this.stage.on('mouseup', () => this.endPickHue());
        
        this.layerUtilities.batchDraw();
    }

    private startPickHue(e: Konva.KonvaEventObject<MouseEvent>) {
        this.dragPicker = true;
        this.pickHue(e, this.stage);
    }

    private pickHue(e: Konva.KonvaEventObject<MouseEvent>, element: any) {
        if (this.dragPicker) {
            const pos = element instanceof Konva.Stage == true ? element.getPointerPosition() : element.position();
            const posRelative = element instanceof Konva.Stage == true ? element.getRelativePointerPosition() : element.position();

            console.log(pos, posRelative);

            if (!pos || !posRelative || e.target.getAttr("pick") == undefined) return;

            const imageData = this.layerUtilities.getContext().getImageData(pos.x, pos.y, 1, 1).data;
            const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;
            this.selectedColor = rgbaColor;

            this.picker.position({
                x: posRelative.x,
                y: posRelative.y,
            });

            this.colorPreview.fill(rgbaColor);
            this.layerUtilities.batchDraw();
        }
    }

    private endPickHue() {
        this.dragPicker = false;
    }

    private fillGradient() {
        const blockWidth = this.colorBlock.width();
        const blockHeight = this.colorBlock.height();

        const gradientWhite = new Konva.Rect({
            x: 0,
            y: 0,
            width: blockWidth,
            height: blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: blockWidth, y: 0 },
            fillLinearGradientColorStops: [0, 'rgba(255,255,255,1)', 1, 'rgba(255,255,255,0)'],
            block: true,
            pick: true,
        });

        const gradientBlack = new Konva.Rect({
            x: 0,
            y: 0,
            width: blockWidth,
            height: blockHeight,
            fillLinearGradientStartPoint: { x: 0, y: 0 },
            fillLinearGradientEndPoint: { x: 0, y: blockHeight },
            fillLinearGradientColorStops: [0, 'rgba(0,0,0,0)', 1, 'rgba(0,0,0,1)'],
            block: true,
            pick: true,
        });

        this.picker = new Konva.Circle({
            x: 0,
            y: 0,
            radius: 5,
            fill: 'red',
            listening: false,
            draggable: false,
        });

        this.layerUtilities.add(gradientWhite);
        this.layerUtilities.add(gradientBlack);
        this.layer.add(this.picker);
    }

    private startDrag(e: Konva.KonvaEventObject<MouseEvent>) {
        this.drag = true;
        this.changeColor(e);
    }

    private stopDrag() {
        this.drag = false;
    }

    private onDrag(e: Konva.KonvaEventObject<MouseEvent>) {
        if (this.drag) {
            this.changeColor(e);
        }
    }

    private changeColor(e: Konva.KonvaEventObject<MouseEvent>) {
        const pos = this.stage.getPointerPosition();
        if (!pos) return;

        const imageData = this.layerUtilities.getContext().getImageData(pos.x, pos.y, 1, 1).data;
        const rgbaColor = `rgba(${imageData[0]}, ${imageData[1]}, ${imageData[2]}, 1)`;
        this.selectedColor = rgbaColor;

        this.colorBlock.fill(rgbaColor);
        this.pickHue(e, this.picker);
        this.layerUtilities.batchDraw();
    }
}