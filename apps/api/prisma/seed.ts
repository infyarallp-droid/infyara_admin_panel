import { PrismaClient, CourseCategory, Discipline, DurationType, ProductType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const paise = (rupees: number) => BigInt(Math.round(rupees * 100));

// Health checklist + clause text lifted from the Moksha consent PDF.
const consentSections = {
  healthOptions: [
    { key: 'none_fit', label: 'None of the below / I am currently fit to participate' },
    { key: 'heart', label: 'Heart/cardiovascular condition' },
    { key: 'bp', label: 'High/low BP' },
    { key: 'diabetes', label: 'Diabetes' },
    { key: 'asthma', label: 'Asthma/breathing condition' },
    { key: 'dizziness', label: 'Dizziness/fainting' },
    { key: 'epilepsy', label: 'Epilepsy/seizures' },
    { key: 'migraine', label: 'Migraine/severe headaches' },
    { key: 'back_neck', label: 'Back/neck problem' },
    { key: 'joint_injury', label: 'Knee/shoulder/joint injury' },
    { key: 'recent_surgery', label: 'Recent surgery' },
    { key: 'osteoporosis', label: 'Osteoporosis/bone condition' },
    { key: 'hernia', label: 'Hernia' },
    { key: 'pregnancy_postpartum', label: 'Pregnancy/postpartum' },
    { key: 'current_pain', label: 'Current pain/injury' },
    { key: 'medication', label: 'Medication affecting exercise' },
  ],
  clauses: {
    safety: [
      'I understand that yoga, Pilates, stretching, breathing practices and related physical activity involve inherent risks, including soreness, strain, sprain, aggravation of a pre-existing condition, dizziness, falls or other injury.',
      'I confirm that I have disclosed relevant health conditions, injuries, pregnancy/postpartum status, medications or restrictions to the trainer/organisation and will update them if anything changes.',
      'I will work within my own ability and boundaries. I will not force, compete or continue a movement that causes pain, dizziness, unusual breathlessness or other concerning symptoms. I will immediately inform the trainer.',
      'I understand that trainers provide general exercise/yoga instruction and are not medical professionals. I will obtain medical clearance when appropriate and follow my healthcare professional’s advice.',
      'I understand that the organisation cannot guarantee that participation will be free from injury. I voluntarily accept the ordinary/inherent risks of participation.',
    ],
    policies: [
      'I understand that Moksha Wellness may change or substitute trainers based on class requirements, availability, operational needs, quality standards or other circumstances.',
      'I agree to follow trainer instructions, studio safety procedures and applicable SOPs, and to ask for a modification whenever required.',
      'I understand that class timings, batches, venues, online links and schedules may be changed when reasonably required, with material changes communicated through normal channels.',
      'I understand that Moksha Wellness is not responsible for loss, theft or damage to personal belongings brought to the studio, except to the extent responsibility cannot lawfully be excluded. I will keep valuables secure.',
    ],
    conduct: [
      'Treat trainers, staff and fellow students with respect; no harassment, discrimination, bullying, threats or abusive language.',
      'Follow studio instructions, safety rules, class etiquette and reasonable requests from trainers/staff.',
      'Arrive on time, maintain personal hygiene and wear appropriate clothing for the class.',
      'Keep phones on silent during class and maintain a calm practice environment.',
      'Avoid attending when unwell or when a medical condition makes participation unsafe; inform the trainer before class.',
      'Respect studio property and other students’ belongings; report damage or safety concerns promptly.',
    ],
    final: [
      'I confirm that I have read and understood this form, have had the opportunity to ask questions, have disclosed relevant health information to the best of my knowledge, and voluntarily consent to participate.',
      'I agree to follow the safety requirements, studio policies and Code of Conduct.',
      'I understand that I am responsible for monitoring my own limits and communicating concerns to the trainer.',
    ],
  },
};

async function main() {
  // 1. First admin
  const adminEmail = 'admin@mokshawellness.in';
  const passwordHash = await bcrypt.hash('ChangeMe@123', 10);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { name: 'Studio Admin', email: adminEmail, passwordHash, role: 'SUPER_ADMIN' },
  });
  console.log(`👤 Admin ready: ${adminEmail} / ChangeMe@123  (change on first login)`);

  // 2. Active consent template (v1)
  const existingTpl = await prisma.consentTemplate.findFirst({ where: { version: 1 } });
  if (!existingTpl) {
    await prisma.consentTemplate.create({
      data: {
        version: 1,
        title: 'Student Consent, Risk Acknowledgement & Code of Conduct',
        sections: consentSections,
        isActive: true,
      },
    });
    console.log('📄 Consent template v1 created (from PDF)');
  }

  // 3. Sample courses + plans
  const hatha = await prisma.course.create({
    data: {
      name: 'Hatha Yoga',
      category: CourseCategory.REGULAR,
      discipline: Discipline.YOGA,
      plans: {
        create: [
          { title: '1 Month', durationType: DurationType.MONTH_1, durationValue: 30, pricePaise: paise(2500), sessionsPerWeek: 5 },
          { title: '3 Months', durationType: DurationType.MONTH_3, durationValue: 90, pricePaise: paise(6500), sessionsPerWeek: 5 },
          { title: '12 Months', durationType: DurationType.MONTH_12, durationValue: 365, pricePaise: paise(22000), sessionsPerWeek: 5 },
        ],
      },
    },
  });

  await prisma.course.create({
    data: {
      name: 'Yoga Teacher Training (TTC)',
      category: CourseCategory.TEACHER_TRAINING,
      discipline: Discipline.YOGA,
      plans: {
        create: [
          { title: '200 Hours TTC', durationType: DurationType.HRS_200, durationValue: 200, pricePaise: paise(60000) },
          { title: '300 Hours TTC', durationType: DurationType.HRS_300, durationValue: 300, pricePaise: paise(85000) },
          { title: '600 Hours TTC', durationType: DurationType.HRS_600, durationValue: 600, pricePaise: paise(150000) },
        ],
      },
    },
  });

  // 4. Class timings
  await prisma.classTiming.createMany({
    data: [
      { courseId: hatha.id, label: '6:00 – 7:00 AM', days: ['MON', 'WED', 'FRI'] },
      { courseId: hatha.id, label: '7:00 – 8:00 AM', days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] },
      { courseId: hatha.id, label: '6:00 – 7:00 PM', days: ['MON', 'WED', 'FRI'] },
    ],
  });

  // 5. Merchandise
  const mat = await prisma.product.create({ data: { name: 'Yoga Mat', type: ProductType.MAT } });
  await prisma.productVariant.createMany({
    data: [
      { productId: mat.id, variantLabel: '4mm', attributes: { thickness: '4mm' }, sku: 'MAT-4MM', pricePaise: paise(800), stockQty: 20, reorderLevel: 5 },
      { productId: mat.id, variantLabel: '6mm', attributes: { thickness: '6mm' }, sku: 'MAT-6MM', pricePaise: paise(1200), stockQty: 20, reorderLevel: 5 },
    ],
  });

  const tshirt = await prisma.product.create({ data: { name: 'Moksha T-Shirt', type: ProductType.TSHIRT } });
  await prisma.productVariant.createMany({
    data: ['S', 'M', 'L', 'XL'].map((size) => ({
      productId: tshirt.id,
      variantLabel: size,
      attributes: { size },
      sku: `TSHIRT-${size}`,
      pricePaise: paise(499),
      stockQty: 15,
      reorderLevel: 4,
    })),
  });

  const drink = await prisma.product.create({ data: { name: 'Nutrition Drink', type: ProductType.NUTRITION_DRINK } });
  await prisma.productVariant.createMany({
    data: ['Chocolate', 'Vanilla', 'Mango'].map((flavour) => ({
      productId: drink.id,
      variantLabel: flavour,
      attributes: { flavour },
      sku: `DRINK-${flavour.toUpperCase()}`,
      pricePaise: paise(150),
      stockQty: 30,
      reorderLevel: 8,
    })),
  });

  console.log('🌱 Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
