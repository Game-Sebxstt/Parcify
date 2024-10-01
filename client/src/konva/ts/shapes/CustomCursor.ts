import Konva from 'konva';

interface ConfigName {
    name_user: string;
    font_size: number;
    padding: {top: number, right: number, bottom: number, left: number};
}

interface ConfigCursor {
    fill: string;
    x: number;
    y: number;
    id: string;
    id_user: string;
    string_svg: string;
    margin?: {top: number, right: number, bottom: number, left: number};
}
interface ConfigGlobal {
    configName: ConfigName;
    configCursor: ConfigCursor;
}

export class CustomCursor {
    private configGlobal: ConfigGlobal
    private configCursor: ConfigCursor;
    private stage: Konva.Stage;
    private layer: Konva.Layer;
    private cursor: Konva.Image | null = null;
    private name: Konva.Text | null = null;
    private nameBg: Konva.Rect | null = null;
    private configName: ConfigName;
    private id: string;
    private id_user: string;
    private scale: number = 1;

    constructor(configGlobal: ConfigGlobal, layer: Konva.Layer, stage: Konva.Stage) {
        this.configGlobal = configGlobal;
        this.configCursor = configGlobal.configCursor;
        this.configName = configGlobal.configName
        this.stage = stage;
        this.layer = layer;
        this.id = configGlobal.configCursor.id;
        this.id_user = configGlobal.configCursor.id_user;
    }

    public initCursor() {
        this.createCursor();
        this.eventsGlobal();
    }

    private createCursor() {
        this.name = new Konva.Text({
            x: this.configCursor.x,
            y: this.configCursor.y - this.configName.font_size,
            text: this.configName.name_user,
            fontSize: this.configName.font_size,
            letterSpacing: 1.2,
            fontFamily: 'Arial',
            fill: 'white',
            align: 'center',
            visible: false,
        });

        this.nameBg = new Konva.Rect({
            x: this.configCursor.x + this.name.width() + 5,
            y: this.configCursor.y - this.configName.font_size,
            width: this.name.width() + ((this.configName.padding.left + this.configName.padding.right) * 2),
            height: this.name.height() + ((this.configName.padding.top + this.configName.padding.bottom) * 2),
            fill: this.configCursor.fill,
            visible: false
        })

        Konva.Image.fromURL(this.configCursor.string_svg, (image) => {
            this.cursor = image;
            this.cursor.setAttrs({
                x: this.configCursor.x,
                y: this.configCursor.y,
                scaleX: 1,
                scaleY: 1,
                visible: false,
            });
            this.layer.add(this.cursor);
            this.layer.draw();
        })

        this.layer.add(this.name);
        this.layer.add(this.nameBg);
        this.name.moveToTop();
        this.layer.draw();
    }

    private updateScale() {
        this.scale = this.stage.scaleX() > 1 ? this.stage.scaleX() : 1;
    }

    private updateScaleCursor() {
        if(!this.cursor || !this.name) return;

        this.name.fontSize(this.name.fontSize());

        this.layer.batchDraw();
    }

    private eventsGlobal() {
        this.stage.on('wheel', () => {
            this.updateScale();
            this.updateScaleCursor();
        });
    }

    public updateCursor(options: ConfigCursor) {
        this.configCursor.x = options.x;
        this.configCursor.y = options.y;

        if (this.cursor && this.name && this.nameBg) {
            const marginX = (this.configCursor.margin?.right ?? 0) + (this.configCursor.margin?.left ?? 0);
            const marginY = (this.configCursor.margin?.top ?? 0) + (this.configCursor.margin?.bottom ?? 0);
            const defaultPosX = this.configCursor.x + this.cursor.width() + 5 + marginX;
            const defaultPosY = this.configCursor.y + this.nameBg.height() / 2 + marginY;

            this.cursor.position({
                x: this.configCursor.x,
                y: this.configCursor.y,
            });

            this.name?.position({
                x: defaultPosX + (this.nameBg?.width() ?? 0) / 2 - this.name?.width() / 2,
                y: defaultPosY + (this.nameBg?.height() ?? 0) / 2 - this.name?.height() / 2,
            });

            this.nameBg?.position({
                x: defaultPosX,
                y: defaultPosY,
            });

            this.name?.visible(true);
            this.nameBg?.visible(true);
            this.cursor.visible(true);
            this.updateScaleCursor();
            this.layer.draw();
        }
    }

    public removeCursor() {
        this.cursor?.destroy();
        this.nameBg?.destroy();
        this.name?.destroy();
        this.layer.draw();
    }
}
