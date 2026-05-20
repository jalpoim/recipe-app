# Setup Guide

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up or sign in.
2. Click **New project**.
3. Fill in name, database password, and region. Click **Create new project**.
4. Wait ~2 minutes for provisioning.

## 2. Get your credentials

In the Supabase dashboard:

1. Go to **Project Settings** → **API**.
2. Copy the **Project URL** (looks like `https://xxxxxxxxxxxx.supabase.co`).
3. Copy the **anon / public** key (starts with `eyJ…`).

## 3. Update `.env.local`

Open `.env.local` in the project root and replace the placeholder values:

```
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
```

Do **not** commit this file — it is already in `.gitignore`.

## 4. Configure Supabase Auth

In the Supabase dashboard:

1. Go to **Authentication** → **Providers**.
2. Make sure **Email** is enabled. Set **Confirm email** to **on** (this is how magic links work).
3. Go to **Authentication** → **URL Configuration**.
4. Under **Redirect URLs**, add:
   - `http://localhost:3000/auth/callback` (for local development)
   - `https://your-vercel-domain.vercel.app/auth/callback` (once deployed)
5. Set **Site URL** to `http://localhost:3000` for local dev (update after deploying).

## 5. Run locally

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the sign-in page without the "Configure Supabase" warning. Enter your email and check your inbox for the magic link.

## 6. Test sign-in

1. Enter an email address on the sign-in page.
2. Check that email for the magic link.
3. Click the link → you should land on `/app` showing "Signed in as \<email\>".
4. Click **Sign out** → you should be redirected back to `/`.

## 7. Deploy to Vercel

1. Push the project to a GitHub repository.
2. In [Vercel](https://vercel.com), click **Add New Project** and import the repo.
3. In the Vercel project settings → **Environment Variables**, add:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` — your Supabase anon key
4. Deploy. Once live, go back to Supabase → **Authentication** → **URL Configuration** and add your Vercel domain to **Redirect URLs** and update **Site URL**.

## Environment variables reference

| Variable               | Required | Where to get it              |
| ---------------------- | -------- | ---------------------------- |
| `VITE_SUPABASE_URL`    | Yes      | Supabase → Settings → API    |
| `VITE_SUPABASE_ANON_KEY` | Yes    | Supabase → Settings → API    |
