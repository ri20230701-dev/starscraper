import { Color, MeshStandardMaterial, Vector2, Vector3 } from 'three';
import type { BuildingSnapshot } from '../../application/dto/CitySnapshot';
import { calculateWindowLayout, WINDOW_GRID } from './windowLayout';

const WINDOW_FRAGMENT = /* glsl */ `
varying vec3 vBuildingPosition;
varying vec3 vBuildingNormal;
uniform vec3 uBuildingDimensions;
uniform vec3 uWindowCounts;
uniform vec3 uWindowMargins;
uniform vec2 uWindowPitch;
uniform vec2 uWindowAperture;
uniform uint uBuildingId;
uniform float uWindowLitRatio;
uniform vec3 uWindowEmission;

// Integer mixing is independent of frame, camera, and floating-point sine precision.
uint windowHash(uint value) {
  value ^= value >> 16u;
  value *= 0x7feb352du;
  value ^= value >> 15u;
  value *= 0x846ca68bu;
  return value ^ (value >> 16u);
}

float windowRandom(uint face, uvec2 cell) {
  uint seed = windowHash(uBuildingId ^ 0x9e3779b9u);
  seed = windowHash(seed ^ (face + 1u));
  seed = windowHash(seed ^ cell.x);
  seed = windowHash(seed ^ cell.y);
  return float(seed >> 8u) / 16777216.0;
}

// x = glass coverage; y = lit glass coverage. Roof/bottom return zero.
vec2 buildingWindows() {
  bool side = abs(vBuildingNormal.x) > 0.5;
  vec2 extent = vec2(side ? uBuildingDimensions.z : uBuildingDimensions.x, uBuildingDimensions.y);
  vec2 count = vec2(side ? uWindowCounts.z : uWindowCounts.x, uWindowCounts.y);
  float horizontal = side ? -vBuildingPosition.z * sign(vBuildingNormal.x)
                          : vBuildingPosition.x * sign(vBuildingNormal.z);
  vec2 local = vec2(horizontal, vBuildingPosition.y);
  // BoxGeometry has physical dimensions, so this is a world-unit grid, not stretched UVs.
  vec2 margin = vec2(side ? uWindowMargins.z : uWindowMargins.x, uWindowMargins.y);
  vec2 cellPosition = (local + extent * 0.5 - margin) / uWindowPitch;
  vec2 footprint = max(fwidth(cellPosition), vec2(0.00001));
  if (abs(vBuildingNormal.y) > 0.5 || min(count.x, count.y) < 1.0) return vec2(0.0);

  vec2 cell = floor(cellPosition);
  vec2 distanceFromCenter = abs(fract(cellPosition) - 0.5);
  vec2 halfAperture = uWindowAperture / uWindowPitch * 0.5;
  vec2 edgeAA = footprint * 0.5;
  vec2 aperture = 1.0 - smoothstep(halfAperture - edgeAA, halfAperture + edgeAA, distanceFromCenter);
  float detailedGlass = aperture.x * aperture.y;
  uint face = side ? (vBuildingNormal.x > 0.0 ? 0u : 1u)
                   : (vBuildingNormal.z > 0.0 ? 2u : 3u);
  float lit = windowRandom(face, uvec2(max(cell, vec2(0.0)))) < uWindowLitRatio ? 1.0 : 0.0;

  // A subpixel grid and its random lit bits alias even with smooth rectangle edges.
  // Fade to area × lit-ratio before undersampling; this preserves average light energy.
  float averageWeight = smoothstep(0.18, 0.7, max(footprint.x, footprint.y));
  float averageGlass = (uWindowAperture.x * uWindowAperture.y) / (uWindowPitch.x * uWindowPitch.y);
  vec2 coverage = mix(vec2(detailedGlass, detailedGlass * lit),
                      vec2(averageGlass, averageGlass * uWindowLitRatio), averageWeight);
  // Keep even the averaged glow inside the centered, complete-cell region.
  vec2 firstEdge = smoothstep(-edgeAA, edgeAA, cellPosition);
  vec2 lastEdge = 1.0 - smoothstep(count - edgeAA, count + edgeAA, cellPosition);
  return coverage * firstEdge.x * firstEdge.y * lastEdge.x * lastEdge.y;
}
`;

/** A single standard-lit box per building, extended in the same way as BoardMeshes. */
export function createWindowMaterial(building: BuildingSnapshot): MeshStandardMaterial {
  const layout = calculateWindowLayout(building);
  const material = new MeshStandardMaterial({
    color: new Color(building.color).multiplyScalar(0.55),
    roughness: 0.82,
    metalness: 0.28,
  });
  material.name = `Building ${building.id} procedural windows`;
  const emission = new Color(building.id % 5 === 0 ? '#c3e7ff' : '#ffdab0').multiplyScalar(3.2);
  material.onBeforeCompile = shader => {
    shader.uniforms.uBuildingDimensions = { value: new Vector3(building.width, building.height, building.depth) };
    shader.uniforms.uWindowCounts = {
      value: new Vector3(layout.front.horizontal.count, layout.front.vertical.count, layout.side.horizontal.count),
    };
    shader.uniforms.uWindowMargins = {
      value: new Vector3(layout.front.horizontal.margin, layout.front.vertical.margin, layout.side.horizontal.margin),
    };
    shader.uniforms.uWindowPitch = { value: new Vector2(WINDOW_GRID.horizontalPitch, WINDOW_GRID.verticalPitch) };
    shader.uniforms.uWindowAperture = { value: new Vector2(WINDOW_GRID.windowWidth, WINDOW_GRID.windowHeight) };
    shader.uniforms.uBuildingId = { value: building.id };
    shader.uniforms.uWindowLitRatio = { value: building.windowLitRatio };
    shader.uniforms.uWindowEmission = { value: emission };
    shader.vertexShader = `varying vec3 vBuildingPosition;\nvarying vec3 vBuildingNormal;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvBuildingPosition = position;\nvBuildingNormal = normal;',
    );
    shader.fragmentShader = WINDOW_FRAGMENT + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      '#include <color_fragment>\nvec2 windowCoverage = buildingWindows();\ndiffuseColor.rgb *= mix(1.0, 0.32, windowCoverage.x);',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindowEmission * windowCoverage.y;',
    );
  };
  // Uniforms differ per building, while all 100 materials share one compiled program.
  material.customProgramCacheKey = () => 'starscraper-physical-windows-v1';
  return material;
}
