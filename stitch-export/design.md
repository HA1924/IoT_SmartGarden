---
name: HydroLogic Intelligence
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#434654'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#737685'
  outline-variant: '#c3c6d6'
  surface-tint: '#0c56d0'
  primary: '#003d9b'
  on-primary: '#ffffff'
  primary-container: '#0052cc'
  on-primary-container: '#c4d2ff'
  inverse-primary: '#b2c5ff'
  secondary: '#006e2f'
  on-secondary: '#ffffff'
  secondary-container: '#6bff8f'
  on-secondary-container: '#007432'
  tertiary: '#004869'
  on-tertiary: '#ffffff'
  tertiary-container: '#00618b'
  on-tertiary-container: '#a7d9ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2ff'
  primary-fixed-dim: '#b2c5ff'
  on-primary-fixed: '#001848'
  on-primary-fixed-variant: '#0040a2'
  secondary-fixed: '#6bff8f'
  secondary-fixed-dim: '#4ae176'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005321'
  tertiary-fixed: '#c9e6ff'
  tertiary-fixed-dim: '#89ceff'
  on-tertiary-fixed: '#001e2f'
  on-tertiary-fixed-variant: '#004c6e'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  code-xs:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 8px
  container-padding: 24px
  gutter: 16px
  card-gap: 20px
  sidebar-width: 260px
---

## Brand & Style
The design system focuses on a **Modern Corporate** aesthetic blended with **Glassmorphism** to reflect the precision and technical sophistication of ESP32-powered irrigation. The target audience includes agricultural technicians and smart-farm operators who require high data density without cognitive overload.

The UI evokes a sense of clarity, efficiency, and growth. By utilizing frosted glass surfaces and subtle blurs, the system differentiates between the hardware's raw data and the user's actionable controls. The atmosphere is professional and "high-tech" yet grounded in the physical reality of water management and plant health.

## Colors
The palette is rooted in the "Water & Growth" narrative. 
- **Primary (Deep Blue):** Represents reliability, depth, and the fluid nature of irrigation. Used for primary actions and navigation.
- **Secondary (Vibrant Green):** Symbolizes plant health, active growth, and "Go" states.
- **Tertiary (Sky Blue):** Used for hydration data, humidity levels, and secondary data visualizations.
- **Neutrals:** A range of cool grays (Slate) provides a clean, institutional backdrop that ensures legibility.
- **Semantic Colors:** Critical alerts use a soft Red (#EF4444), while warnings use Amber (#F59E0B), ensuring high-contrast status communication.

## Typography
We use **Inter** for its exceptional legibility in data-heavy environments. The hierarchy is designed to highlight key metrics (like soil moisture percentages) through bold weights and larger scales. 

For technical ESP32 status logs or device IDs, a secondary monospaced font (**JetBrains Mono**) is used to provide a "developer-friendly" touch. Uppercase labels with slight letter spacing are utilized for category headers to maintain a structured, professional layout.

## Layout & Spacing
The layout follows a **Fluid Grid** model with a sidebar-driven navigation structure. 
- **Desktop:** 12-column grid with 24px margins. Cards span 3, 4, or 6 columns depending on the complexity of the chart.
- **Tablet:** 8-column grid. The sidebar collapses into an icon-only rail or a hamburger menu.
- **Mobile:** 4-column grid. All charts and data cards stack vertically. 

The rhythm is based on an 8px baseline, ensuring that tight data groups (like sensor readouts) feel cohesive while maintaining enough white space to prevent visual fatigue.

## Elevation & Depth
Depth is achieved through **Glassmorphism** and soft **Tonal Layering**. 
- **Level 1 (Background):** A light gray (#F8FAFC) matte surface.
- **Level 2 (Cards):** White background with 70% opacity, a 1px white border, and a subtle backdrop blur (12px). These use a very soft ambient shadow (0px 4px 20px rgba(0,0,0,0.05)).
- **Level 3 (Popovers/Modals):** High-opacity white with more pronounced shadows to indicate temporary interaction.

This approach creates a "lightweight" feel where data appears to float over the system background, mimicking a clean laboratory or control room environment.

## Shapes
This design system utilizes a **Rounded** (Level 2) shape language. Standard cards and containers use a 0.5rem (8px) radius, while larger dashboard sections may use 1rem (16px) for a softer, more modern aesthetic. 

The roundedness is intended to balance the "hard" data of the charts with a user-friendly, approachable interface. Status indicators and pills use full-round (100px) corners to distinguish them from structural layout elements.

## Components
- **Data Cards:** Translucent white backgrounds, thin light borders, and subtle blur. Titles are placed top-left, with primary metrics in `display-lg`.
- **Charts:** Line charts use smooth curves (bezier) with primary blue strokes and a light blue gradient fill. Grid lines should be faint (#E2E8F0) to keep the focus on the data trend.
- **Toggle Switches:** Used for pump and valve controls. The "On" state is `secondary_color_hex` (Green) with a physical "sliding" animation.
- **Status Badges:** Small pills with low-opacity backgrounds and high-opacity text (e.g., "Active" is Light Green bg with Dark Green text).
- **Input Fields:** Clean, outlined boxes with 8px radius. Focus states use a 2px `primary_color_hex` ring.
- **Buttons:** Primary buttons are solid `primary_color_hex` with white text. Secondary buttons are "Ghost" style (outlined) to maintain the glassmorphic lightness.
- **ESP32 Health Monitor:** A specialized component showing Wi-Fi signal strength (RSSI), battery/power levels, and uptime in a compact list format.
