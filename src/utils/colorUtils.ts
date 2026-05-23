export function getContrastColor(hexColor: string): string {
    // Remove hash if present
    const hex = hexColor.replace(/^#/, '');
    
    // Parse RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Calculate YIQ luminance
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    
    // Return black for bright colors, white for dark colors
    return (yiq >= 128) ? '#000000' : '#ffffff';
}
