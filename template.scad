// =====================================================
//  SVG ORNAMENTO — placa base + relieve desde SVG  (v1)
//  Importa temp/current.svg, lo extruye (relieve o
//  inlay) y genera una placa base con su misma forma.
// =====================================================

$fn = 64;

/* [Dibujo] */
Design_Size      = 60;    // [10:1:200]  tamaño máximo del dibujo en mm
Flip_Vertical    = true;  // true = el relieve se ve igual que en la pantalla
Relief_Mode      = "raised"; // ["raised","inlay"]  raised=relieve, inlay=incrustado a ras

/* [Placa y relieve] */
Base_Enable     = true; // [true,false]  agregar o quitar la base/placa
Base_Thickness  = 1.6;   // [0.6:0.1:8.0]  grosor de la placa base
Base_Border     = 4.0;   // [0.0:0.5:15.0]  margen de placa alrededor del dibujo
Relief_Thickness = 2.0;  // [0.5:0.1:8.0]  alto del relieve / profundidad del inlay

/* [Llavero] */
Keychain_Hole     = false; // true = agujero para llavero o cordón
Keychain_Diameter = 4.0;   // [1.5:0.1:8.0]
Keychain_Edge_Gap = 2.5;   // [0.0:0.5:10.0]  distancia del centro del agujero al borde superior del dibujo

/* [Cores] */
Color_Base   = "#1a1a1a"; // color
Color_Relief = "#F4A0B0"; // color

/* [Oculto] */
_fw = Design_Size / 100;              // 1 unidad SVG normalizada -> mm
_svg_half_h = __SVG_HALF_H__;         // media altura real del dibujo en unidades SVG (lo calcula el servidor)
_svg_half_w = __SVG_HALF_W__;         // media anchura real del dibujo en unidades SVG
_inlay       = Relief_Mode != "raised";
_depth       = min(Relief_Thickness, Base_Thickness - 0.3);  // profundidad útil del inlay (sin perforar la placa)
_reparar     = __SVG_REPAIR__;        // el SVG contiene contornos auto-intersecantes (el servidor lo detecta)

// Dibujo importado: el lienzo SVG va en coords 0..100 (y abajo), contenteo
// centrado en (50,50). Lo llevamos al origen con el espejo de Y (50-Y) para que
// quede "derecho" y luego lo escalamos a Design_Size; Flip_Vertical invierte el
// espejo (lo imprime cabeza abajo).
// _reparar: un contorno auto-intersecante se triangula con triángulos de área
// cero al importar y rompe la exportación 3MF ("Can't add triangle to 3MF model").
// Un offset(r=0.02) infinitesimal re-triangula la silueta limpiamente sin
// cambiar la forma (abultado < 0.04 mm, inapreciable en impresión).
module diseno_2d() {
  translate([-50 * _fw, (Flip_Vertical ? 1 : -1) * 50 * _fw, 0])
    scale([_fw, (Flip_Vertical ? -1 : 1) * _fw])
      if (_reparar) offset(r=0.02, $fn=24) import("current.svg");
      else import("current.svg");
}

// Placa base: la silueta del dibujo ensanchada por Base_Border
module base_3d() {
  if (Base_Enable) {
    color(Color_Base)
    difference() {
      linear_extrude(Base_Thickness, convexity=10)
        offset(r=Base_Border)
          diseno_2d();
      if (_inlay) {
        // En modo inlay la placa se hace sólida y se le excava el hueco del dibujo
        translate([0, 0, Base_Thickness - _depth])
          linear_extrude(_depth + 0.2, convexity=10)
            diseno_2d();
      }
      if (Keychain_Hole) {
        // El borde "superior" impreso queda en +halfH·_fw (Flip_Vertical=true,
        // imprimimos derecho) o en -halfH·_fw (Flip_Vertical=false).
        translate([0, (Flip_Vertical ? 1 : -1) * (_svg_half_h * _fw + Keychain_Edge_Gap), -0.5])
          cylinder(h=Base_Thickness + 1, d=Keychain_Diameter, $fn=48);
      }
    }
  }
}

// Relieve / inlay (color 2). Sin base, el relieve se imprime como pieza sola
// (altura Relief_Thickness desde z=0). Con base, apoya sobre la placa.
_b_z = Base_Enable ? (_inlay ? Base_Thickness - _depth : Base_Thickness) : 0;
_b_h = Base_Enable ? (_inlay ? _depth : Relief_Thickness) : Relief_Thickness;
module relief_3d() {
  color(Color_Relief)
  translate([0, 0, _b_z])
    linear_extrude(_b_h, convexity=10)
      diseno_2d();
}

// Pieza final: placa + relieve
module svg_ornamento() {
  base_3d();
  relief_3d();
}

svg_ornamento();