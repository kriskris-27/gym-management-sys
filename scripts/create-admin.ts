import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function createAdminUser() {
  try {
    console.log('🔐 Creating admin user...')

    // Check if admin user already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { username: 'admin' }
    })

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists!')
      console.log('Username: admin')
      console.log('Role:', existingAdmin.role)
      return
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash('admin123', 10)

    // Create admin user
    const admin = await prisma.user.create({
      data: {
        username: 'admin',
        password: hashedPassword,
        role: 'ADMIN'
      }
    })

    console.log('✅ Admin user created successfully!')
    console.log('Username: admin')
    console.log('Password: admin123')
    console.log('Role:', admin.role)
    console.log('User ID:', admin.id)

  } catch (error) {
    console.error('❌ Error creating admin user:', error)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the function
createAdminUser()
