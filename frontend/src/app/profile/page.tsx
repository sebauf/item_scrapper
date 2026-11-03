import { getProfile } from '@/lib/api';
import { ProfileForm } from '@/components/ProfileForm';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const profile = await getProfile();

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Profil</h1>
        <p className="text-sm text-muted mt-1 truncate" title={profile.email}>
          {profile.email}
        </p>
      </div>
      <ProfileForm profile={profile} />
    </main>
  );
}
