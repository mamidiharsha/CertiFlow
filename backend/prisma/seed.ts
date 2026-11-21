import { PrismaClient, BatchStatus, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const district = await prisma.district.upsert({
    where: { code: 'MH12' },
    update: { name: 'Pune' },
    create: { id: uuidv4(), name: 'Pune', code: 'MH12' },
  });

  const centre = await prisma.trainingCentre.upsert({
    where: { id: '00000000-0000-4000-8000-000000000001' },
    update: { name: 'Pragati Skills Academy', districtId: district.id },
    create: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Pragati Skills Academy',
      districtId: district.id,
    },
  });

  const passwordHash = await bcrypt.hash('password123', 10);
  const users = [
    ['Anika', 'anika@certiflow.in', Role.CENTRE, district.id, centre.id],
    ['Dev', 'dev@certiflow.in', Role.DISTRICT_OFFICER, district.id, null],
    ['Meera', 'meera@certiflow.in', Role.DISTRICT_OFFICER, district.id, null],
    ['Kabir', 'kabir@certiflow.in', Role.DISTRICT_OFFICER, district.id, null],
    ['Neha', 'neha@certiflow.in', Role.QUALITY_TEAM, null, null],
    ['Farah', 'farah@certiflow.in', Role.STATE_OFFICE, null, null],
  ] as const;

  for (const [name, email, role, districtId, centreId] of users) {
    await prisma.user.upsert({
      where: { email },
      update: {
        name,
        passwordHash,
        role,
        districtId,
        centreId,
      },
      create: {
        id: uuidv4(),
        name,
        email,
        passwordHash,
        role,
        districtId,
        centreId,
      },
    });
  }

  const existing = await prisma.batch.count({
    where: { centreId: centre.id },
  });

  if (existing === 0) {
    const batch = await prisma.batch.create({
      data: {
        id: uuidv4(),
        centreId: centre.id,
        districtId: district.id,
        title: 'Digital Skills Batch - November 2026',
        candidateCount: 3,
        status: BatchStatus.DRAFT,
        candidates: {
          create: [
            { id: uuidv4(), name: 'Aarav Sharma', phone: '9876543210', course: 'Web Development', score: 88 },
            { id: uuidv4(), name: 'Priya Patil', phone: '9876543211', course: 'Web Development', score: 92 },
            { id: uuidv4(), name: 'Rahul Kumar', phone: '9876543212', course: 'Web Development', score: 85 },
          ],
        },
      },
    });

    await prisma.batch.findUnique({ where: { id: batch.id } });
  }

  console.log('Seed completed');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
