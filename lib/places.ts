/**
 * Demo destination presets.
 *
 * There is no geocoder in this build, so routing offers a short fixed list of
 * destinations plus manual coordinate entry. Replace these with points near
 * wherever the app is being shown, and set NEXT_PUBLIC_DEFAULT_CENTER to match.
 */

export interface Place {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

export const DESTINATIONS: Place[] = [
  { id: "library", label: "Library entrance", lat: 37.3197, lng: -122.0462 },
  { id: "transit", label: "Transit stop", lat: 37.3206, lng: -122.0468 },
  { id: "crossing", label: "Main crossing", lat: 37.3188, lng: -122.0447 },
  { id: "plaza", label: "Central plaza", lat: 37.3191, lng: -122.0475 },
  { id: "parking", label: "Parking structure", lat: 37.321, lng: -122.044 },
];
