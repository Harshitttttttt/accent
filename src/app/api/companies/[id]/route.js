import { dbConnect } from '@/utils/database';

// GET specific company
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const companyId = parseInt(id);
    
    const db = await dbConnect();
    
    const [rows] = await db.execute(
      'SELECT * FROM companies WHERE id = ?',
      [companyId]
    );
    
    await db.end();
    
    if (rows.length === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      data: rows[0] 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to fetch company' 
    }, { status: 500 });
  }
}

// PUT - Update company
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const companyId = parseInt(id);
    const data = await request.json();
    
    const {
      company_id,
      company_name,
      industry,
      company_size,
      website,
      phone,
      email,
      address,
      city,
      state,
      country,
      postal_code,
      description,
      founded_year,
      revenue,
      notes
    } = data;

    const db = await dbConnect();
    
    // Update the company
    const [result] = await db.execute(
      `UPDATE companies SET 
        company_id = COALESCE(?, company_id),
        company_name = COALESCE(?, company_name),
        industry = COALESCE(?, industry),
        company_size = COALESCE(?, company_size),
        website = COALESCE(?, website),
        phone = COALESCE(?, phone),
        email = COALESCE(?, email),
        address = COALESCE(?, address),
        city = COALESCE(?, city),
        state = COALESCE(?, state),
        country = COALESCE(?, country),
        postal_code = COALESCE(?, postal_code),
        description = COALESCE(?, description),
        founded_year = COALESCE(?, founded_year),
        revenue = COALESCE(?, revenue),
        notes = COALESCE(?, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [
        company_id, company_name, industry, company_size, website, phone, email,
        address, city, state, country, postal_code, description,
        founded_year, revenue, notes, companyId
      ]
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Company updated successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to update company' 
    }, { status: 500 });
  }
}

// DELETE company
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const companyId = parseInt(id);
    
    const db = await dbConnect();
    
    const [result] = await db.execute(
      'DELETE FROM companies WHERE id = ?',
      [companyId]
    );
    
    await db.end();
    
    if (result.affectedRows === 0) {
      return Response.json({ 
        success: false, 
        error: 'Company not found' 
      }, { status: 404 });
    }
    
    return Response.json({ 
      success: true, 
      message: 'Company deleted successfully' 
    });
  } catch (error) {
    console.error('Database error:', error);
    return Response.json({ 
      success: false, 
      error: 'Failed to delete company' 
    }, { status: 500 });
  }
}
