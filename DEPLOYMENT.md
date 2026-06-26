# HAU M.Sc Agri Entrance Deployment

This is a separate project from Dormic. Dormic was used only as the deployment-flow reference.

## Project names

- App name: `HAU M.Sc Agri Entrance`
- Suggested GitHub repository: `HAU-MSc-Agri-Entrance`
- Firebase project: `hau-msc-agri-entrance`
- Suggested Vercel project: `hau-msc-agri-entrance`

## Flow

1. Build and test locally.
2. Create Firebase project `hau-msc-agri-entrance`.
3. Firebase web config is stored in `src/firebase-config.js`.
4. Create the new GitHub repository and push `main`.
5. Import the GitHub repository into Vercel.
6. Add Firebase service account JSON as a GitHub Actions secret.
7. Deploy Firebase Hosting, Firestore rules, and Storage rules.

## Manual commands

```bash
npm run deploy:vercel
npm run deploy:firebase
npm run deploy:firebase:rules
npm run deploy:firebase:hosting
```
