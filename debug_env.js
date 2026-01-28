import dotenv from 'dotenv';
dotenv.config();

console.log('--- ENV DEBUG ---');
console.log('PWD:', process.cwd());
console.log('MONGODB_ATLAS_URI (exists):', !!process.env.MONGODB_ATLAS_URI);
if (process.env.MONGODB_ATLAS_URI) {
    const uri = process.env.MONGODB_ATLAS_URI;
    const masked = uri.replace(/:([^@]+)@/, ':****@');
    console.log('MONGODB_ATLAS_URI (masked):', masked);
}
console.log('PORT:', process.env.PORT);
console.log('--- ALL KEYS ---');
console.log(Object.keys(process.env).filter(k => !k.includes('SESSION') && !k.includes('USER')).join(', '));
process.exit(0);
